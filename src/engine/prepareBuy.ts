import { encodeFunctionData, parseAbi, type Address } from "viem";
import { executionMandateSchema, validateExecution } from "./executionValidator.js";

export const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
]);

/** Unsigned review artifact only. SwapRouter02's single-swap struct has no
 * deadline, so use its deadline-enforcing multicall overload. */
export function prepareBuy(input: Parameters<typeof validateExecution>[0]) {
  const result = validateExecution(input);
  if (!result.ok) return result;
  const m = executionMandateSchema.parse(input.mandate);
  const swap = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{
    tokenIn: m.route.quoteToken as Address, tokenOut: m.route.token as Address,
    fee: m.route.fee, recipient: m.recipient as Address, amountIn: BigInt(result.amountIn),
    amountOutMinimum: BigInt(result.minimumOutput), sqrtPriceLimitX96: 0n,
  }] });
  return { ...result, transactionAuthorized: false as const, request: {
    from: m.signer as Address, to: m.route.router as Address, chainId: m.route.chainId,
    value: "0", data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [BigInt(result.deadline), [swap]] }),
  } };
}
