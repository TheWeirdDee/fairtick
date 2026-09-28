import { existsSync,readFileSync,writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const file=".env.local";
let content=existsSync(file)?readFileSync(file,"utf8"):readFileSync(".env.example","utf8");
const current=content.match(/^OPERATOR_SECRET=(.*)$/m)?.[1]?.trim();
if(!current){const line=`OPERATOR_SECRET=${randomBytes(32).toString("hex")}`;content=/^OPERATOR_SECRET=.*$/m.test(content)?content.replace(/^OPERATOR_SECRET=.*$/m,line):content+`\n${line}\n`;writeFileSync(file,content,{mode:0o600});}
console.log("Local operator access is configured in .env.local. Read OPERATOR_SECRET locally to unlock the desk. No key or secret is printed. Set RH_SENDER_ADDRESS to your public address for wallet checks; SERV_API_KEY is optional for authenticated SERV diagnostics. Signing stays disabled.");
