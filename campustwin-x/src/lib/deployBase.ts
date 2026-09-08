// 部署子路径感知:云服务器 nginx 将本站挂在 /campus/ 下,数据请求需带此前缀。
// 构建时由 vite define 注入 __CTX_DEPLOY_BASE__(见 vite.config.ts DEPLOY_BASE);
// 未注入时(如 Node 回归脚本直接编译本文件)缺省 '/'。
// 不用 import.meta.env.BASE_URL 的原因:回归脚本以 commonjs 单文件编译,import.meta 非法。
declare const __CTX_DEPLOY_BASE__: string | undefined
export const DEPLOY_BASE: string =
  typeof __CTX_DEPLOY_BASE__ !== 'undefined' ? __CTX_DEPLOY_BASE__ : '/'
