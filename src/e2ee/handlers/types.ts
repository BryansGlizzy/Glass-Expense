export interface Req {
  method: string;
  path: string;                 // pathname, e.g. /api/jobs/abc/expenses
  query: URLSearchParams;
  m: RegExpMatchArray;          // route match (capture groups = path params)
  body: any;                    // parsed JSON body (or {})
  form: FormData | null;        // multipart body, if any
}
export interface Res { status?: number; json?: any; response?: Response }
export type Handler = (r: Req) => Promise<Res>;
export type Route = [method: string, pattern: RegExp, handler: Handler];

export class BadRequest extends Error { status = 400; }
export class NotFound extends Error { status = 404; }
export class Forbidden extends Error { status = 403; }

export const ok = (json: any = { success: true }): Res => ({ json });
export const bad = (message: string): never => { throw new BadRequest(message); };
