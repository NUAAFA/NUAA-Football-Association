declare module "saxen" {
  export class Parser {
    ns(namespaces: Record<string, string>): this;
    on(event: "openTag", handler: (name: string, attributes: () => Record<string, string>, decode: (value: string) => string, selfClosing: boolean) => void): this;
    on(event: "closeTag", handler: (name: string) => void): this;
    on(event: "text", handler: (value: string, decode: (value: string) => string) => void): this;
    on(event: "error" | "warn" | "attention", handler: (error: unknown) => void): this;
    parse(xml: string): unknown;
  }
}
