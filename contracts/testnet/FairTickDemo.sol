// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// FAIRTICK TESTNET DEMO CONTRACTS — Robinhood Chain testnet (46630) or a local devnet only.
// Every token, price and pool here is a mock with no value. None of it is USDG, a Robinhood
// stock token, a Chainlink feed, Uniswap, or official market data. Liquidity is seeded by
// the demo operator (controlled liquidity). The contracts implement only the interfaces
// FairTick already reads and the events its receipt verifier reconstructs.

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Mock ERC-20 with owner-only minting. Also answers the stock-token oracle-state reads the
/// quote adapter performs; a mock asset has no multiplier changes, pauses or corporate actions.
contract DemoToken {
    string public constant DEMO_NOTICE = "FairTick testnet demo MOCK token: no value, not market data";
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        owner = msg.sender;
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == owner, "OWNER");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "ALLOWANCE");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "BALANCE");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function uiMultiplier() external pure returns (uint256) { return 1e18; }
    function newUIMultiplier() external pure returns (uint256) { return 1e18; }
    function effectiveAt() external pure returns (uint256) { return 0; }
    function oraclePaused() external pure returns (bool) { return false; }
}

/// Operator-set MOCK price with Chainlink AggregatorV3-compatible reads. Not a Chainlink feed.
contract DemoAggregator {
    string public constant DEMO_NOTICE = "FairTick testnet demo MOCK price: operator-set, not market data";
    uint8 public constant decimals = 8;
    uint256 public constant version = 0;
    string public description;
    address public owner;
    uint80 public latestRound;

    struct Round { int256 answer; uint256 startedAt; uint256 updatedAt; }
    mapping(uint80 => Round) internal rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(string memory description_) {
        description = description_;
        owner = msg.sender;
    }

    function updateAnswer(int256 answer) external {
        require(msg.sender == owner, "OWNER");
        require(answer > 0, "ANSWER");
        latestRound += 1;
        rounds[latestRound] = Round(answer, block.timestamp, block.timestamp);
        emit AnswerUpdated(answer, latestRound, block.timestamp);
    }

    function getRoundData(uint80 roundId) public view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[roundId];
        require(r.updatedAt != 0, "NO_DATA");
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }
}

/// Constant-product pool over operator-seeded (controlled) liquidity. Emits Uniswap V3-shaped
/// Swap events: amounts are pool deltas, positive = received by the pool.
contract DemoPool {
    string public constant DEMO_NOTICE = "FairTick testnet demo pool: controlled liquidity, not a market";
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee; // hundredths of a basis point, as in Uniswap V3 (500 = 0.05%)
    address public immutable router;
    uint256 public reserve0;
    uint256 public reserve1;

    event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick);
    event Sync(uint256 reserve0, uint256 reserve1);

    constructor(address tokenA, address tokenB, uint24 fee_, address router_) {
        require(tokenA != tokenB, "TOKENS");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        fee = fee_;
        router = router_;
    }

    function sync() external {
        reserve0 = IERC20Min(token0).balanceOf(address(this));
        reserve1 = IERC20Min(token1).balanceOf(address(this));
        emit Sync(reserve0, reserve1);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        require(tokenIn == token0 || tokenIn == token1, "TOKEN");
        (uint256 rIn, uint256 rOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        require(rIn > 0 && rOut > 0, "NO_LIQUIDITY");
        uint256 inAfterFee = amountIn * (1_000_000 - fee) / 1_000_000;
        return inAfterFee * rOut / (rIn + inAfterFee);
    }

    function swapExactInput(address tokenIn, uint256 amountIn, address recipient) external returns (uint256 amountOut) {
        require(msg.sender == router, "ROUTER");
        bool zeroForOne = tokenIn == token0;
        amountOut = getAmountOut(tokenIn, amountIn);
        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;
        require(IERC20Min(tokenIn).balanceOf(address(this)) >= reserveIn + amountIn, "INPUT_NOT_RECEIVED");
        require(IERC20Min(zeroForOne ? token1 : token0).transfer(recipient, amountOut), "TRANSFER_OUT");
        if (zeroForOne) { reserve0 += amountIn; reserve1 -= amountOut; } else { reserve1 += amountIn; reserve0 -= amountOut; }
        int256 inDelta = int256(amountIn);
        int256 outDelta = -int256(amountOut);
        emit Swap(msg.sender, recipient, zeroForOne ? inDelta : outDelta, zeroForOne ? outDelta : inDelta, sqrtPriceX96(), liquidity(), 0);
    }

    /// sqrt(reserve1 / reserve0) in Q64.96, so FairTick's spot-price read matches the pool.
    function sqrtPriceX96() public view returns (uint160) {
        if (reserve0 == 0) return 0;
        return uint160(_sqrt(reserve1 * (1 << 96) / reserve0) * (1 << 48));
    }

    function liquidity() public view returns (uint128) {
        return uint128(_sqrt(reserve0 * reserve1));
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96(), 0, 0, 0, 0, 0, true);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }
}

/// The two SwapRouter02 calls FairTick prepares: multicall(deadline, data) and exactInputSingle.
contract DemoRouter {
    string public constant DEMO_NOTICE = "FairTick testnet demo router over controlled-liquidity pools";

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    address public immutable owner;
    mapping(bytes32 => address) public pools;

    constructor() { owner = msg.sender; }

    function poolKey(address a, address b, uint24 fee) public pure returns (bytes32) {
        (a, b) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(a, b, fee));
    }

    function setPool(address pool) external {
        require(msg.sender == owner, "OWNER");
        DemoPool p = DemoPool(pool);
        require(p.router() == address(this), "ROUTER");
        pools[poolKey(p.token0(), p.token1(), p.fee())] = pool;
    }

    function poolFor(address a, address b, uint24 fee) public view returns (address pool) {
        pool = pools[poolKey(a, b, fee)];
        require(pool != address(0), "NO_POOL");
    }

    function exactInputSingle(ExactInputSingleParams calldata p) public payable returns (uint256 amountOut) {
        require(msg.value == 0, "NO_ETH");
        require(p.sqrtPriceLimitX96 == 0, "PRICE_LIMIT_UNSUPPORTED");
        address pool = poolFor(p.tokenIn, p.tokenOut, p.fee);
        require(IERC20Min(p.tokenIn).transferFrom(msg.sender, pool, p.amountIn), "STF");
        amountOut = DemoPool(pool).swapExactInput(p.tokenIn, p.amountIn, p.recipient);
        require(amountOut >= p.amountOutMinimum, "Too little received");
    }

    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results) {
        require(block.timestamp <= deadline, "Transaction too old");
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool ok, bytes memory result) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly { revert(add(result, 32), mload(result)) }
            }
            results[i] = result;
        }
    }
}

/// QuoterV2-shaped quote over the demo pool.
contract DemoQuoter {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    DemoRouter public immutable router;

    constructor(DemoRouter router_) { router = router_; }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory p)
        external view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        DemoPool pool = DemoPool(router.poolFor(p.tokenIn, p.tokenOut, p.fee));
        amountOut = pool.getAmountOut(p.tokenIn, p.amountIn);
        return (amountOut, pool.sqrtPriceX96(), 0, 0);
    }
}
