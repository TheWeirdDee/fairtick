import { afterEach,expect,it,vi } from "vitest";
import { authorize } from "../src/lib/server.js";
afterEach(()=>vi.unstubAllEnvs());
const secret="synthetic-operator-secret-for-auth-test";
function request(origin:string,host="127.0.0.1:3198"){return new Request("http://localhost:3198/api/orders",{method:"POST",headers:{authorization:`Bearer ${secret}`,origin,host}});}
it("accepts a browser origin matching incoming host despite Next's internal URL",()=>{vi.stubEnv("OPERATOR_SECRET",secret);expect(authorize(request("http://127.0.0.1:3198"))).toBe("operator");});
it("rejects a cross-origin mutation",()=>{vi.stubEnv("OPERATOR_SECRET",secret);expect(()=>authorize(request("https://elsewhere.example"))).toThrow("ORIGIN_MISMATCH");});
it("honors explicitly configured external origin behind a proxy",()=>{vi.stubEnv("OPERATOR_SECRET",secret);vi.stubEnv("APP_ORIGIN","https://desk.example");expect(authorize(request("https://desk.example"))).toBe("operator");expect(()=>authorize(request("http://desk.example"))).toThrow("ORIGIN_MISMATCH");});
it("rejects missing or incorrect operator authorization",()=>{vi.stubEnv("OPERATOR_SECRET",secret);expect(()=>authorize(new Request("http://localhost/api/orders"))).toThrow("UNAUTHORIZED");});
