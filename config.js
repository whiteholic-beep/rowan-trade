// Rowan Trade on HSK — frontend config
// All HSKSwap addresses verified live 2026-11-23 (see DEPLOY_NOTES.md).
// Contract address is filled in after the HSK testnet deploy; while empty,
// on-chain features show a "not deployed yet" state and the live price
// board, briefing and Q&A (all off-chain reads) work regardless.
const CONFIG = {
  chainId: 133,
  chainHex: "0x85",
  chainName: "HSK Chain Testnet",
  rpcUrl: "https://testnet.hsk.xyz",
  explorer: "https://testnet-explorer.hskchain.net",
  contractAddress: "0x6BC2B406d61CAcE26826c9E4C8F3cd7024Dda358", // RowanTrade on HSK testnet — deployed 2026-11-23, verified on Blockscout
  // HSKSwap (Uniswap V3 fork) on HSK testnet, from @hskswap/sdk-core@1.0.3
  // (HASHKEY_TESTNET_ADDRESSES), cross-checked on-chain with eth_getCode.
  factory: "0x2dC2c21D1049F786C535bF9d45F999dB5474f3A0",
  quoter: "0x73820d9eE5Bf1BfcD429580320FC7A374E8fa1cC",
  router: "0xa6914E66690c6794244B5f66a09eAEbf66254237",
  whsk: "0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6",
  // Pools verified live via the testnet subgraph + token0()/token1()/slot0().
  // WHSK/USDT is the deep pool (liquidity ~4.4e21) and the board's price.
  // WHSK/USDC is a thin test pool (tick implies ~$0) — shown, never quoted.
  pools: [
    {
      pair: "WHSK/USDT",
      pool: "0xff2b7e501c870980bf5641b4a70d0f9fb0f6f6ab",
      feeTier: 500,
      reliable: true,
    },
    {
      pair: "WHSK/USDC",
      pool: "0xfa887000c2d191aa5103a847b514ab0037eaea26",
      feeTier: 10000,
      reliable: false,
    },
  ],
  // Haqi's rules (basis points). The agent enforces these, the contract caps them.
  rules: {
    stopLossBps: 2000, // -20%
    takeProfitBps: 5000, // +50%
    maxPositionBps: 2500, // 25% of paper capital per position
    minPositionBps: 100, // 1%
    maxOpenPositions: 10,
  },
  paperCapitalUsd: 1000, // paper portfolio size for the demo (play money)
};

const ROWAN_TRADE_ABI = [
  "function openPosition(string symbol, uint256 entryPrice, uint256 sizeBps, uint256 stopLossBps, uint256 takeProfitBps) returns (uint256)",
  "function closePosition(uint256 id, uint256 exitPrice, uint8 reason)",
  "function checkIn()",
  "function getPosition(uint256 id) view returns (tuple(uint256 id, address trader, string symbol, uint256 entryPrice, uint256 sizeBps, uint256 stopLossBps, uint256 takeProfitBps, uint256 openedAt, bool open, uint256 exitPrice, uint8 closeReason, uint256 closedAt, int256 pnlBps))",
  "function getOpenPositions(address trader) view returns (uint256[])",
  "function positionCount() view returns (uint256)",
  "function checkInStreak(address) view returns (uint256)",
  "function totalCheckIns(address) view returns (uint256)",
  "function lastCheckInDay(address) view returns (uint256)",
  "function pnlBpsFor(uint256 entryPrice, uint256 exitPrice) view returns (int256)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
];
