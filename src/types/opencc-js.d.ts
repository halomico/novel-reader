declare module "opencc-js/cn2t" {
  export function Converter(options: {
    from: "cn" | "tw" | "hk";
    to: "cn" | "tw" | "hk";
  }): (text: string) => string;
}

declare module "opencc-js/t2cn" {
  export function Converter(options: {
    from: "cn" | "tw" | "hk";
    to: "cn" | "tw" | "hk";
  }): (text: string) => string;
}
