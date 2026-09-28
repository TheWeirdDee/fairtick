import { getVerifiedSymbol, routeContracts } from "../lib/registry.js";
import { activeNetwork } from "../lib/network.js";
import type { ExecutionRoute } from "../engine/executionValidator.js";
/** The single allowlisted route of the active network (mainnet NVDA/USDG unless FAIRTICK_NETWORK=testnet). */
export function allowedRoute():ExecutionRoute {
 const net=activeNetwork(),e=getVerifiedSymbol(net.symbol),c=routeContracts();
 return {chainId:net.chainId,token:e.token.address,quoteToken:c.usdg,pool:e.pool.address,router:c.router,fee:e.pool.feeTier,tokenDecimals:e.token.decimals,quoteDecimals:6};
}
