import Link from "next/link";

const contracts = [
  ["GuardAccount", "0xB30553e2f132126B951D3a6AD4E07EbAa5523b6E"],
  ["PolicyRegistry", "0xcC34D02877E13Bf35Ad7E4eBC747d431B76e748a"],
  ["VerdictContract", "0x7B46f82B37458771Bc88f79e5642e8AEFE2AC52f"],
  ["MutualPool", "0x35d78e526cB230Eaa287AFe622f25DEB07B772e4"],
  ["Blocklist", "0x19afa08179eD7De19a0e45FC35362A663ACa8322"],
  ["Demo USDC", "0xb95fe4d7EEDb98693ded8F3c1a34A59F6Dac114B"],
  ["ERC-8004 Identity", "0x8004A818BFB912233c491871b3d84c89A494BD9e"],
  ["ERC-8004 Validation", "0x8004Cb1BF31DAf7788923b405b754f57acEB4272"],
  ["ERC-8004 Reputation", "0x8004B663056A597Dffe9eCcC1965A193B7388713"],
] as const;

export function ContractLinks() {
  return <section className="card contract-card"><div className="section-head"><div><p className="eyebrow">ON-CHAIN DEPLOYMENT · 5042002</p><h2>Contract addresses.</h2></div><Link className="button compact" href="https://testnet.arcscan.app" target="_blank">Arcscan ↗</Link></div><div className="contract-grid">{contracts.map(([label,address]) => <a key={label} href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noreferrer"><span>{label}</span><code>{address.slice(0, 8)}…{address.slice(-6)}</code><b>↗</b></a>)}</div><p className="fine-print">Addresses are read-only evidence anchors for the deployed Arc testnet stack. Open each link to inspect the contract on Arcscan.</p></section>;
}
