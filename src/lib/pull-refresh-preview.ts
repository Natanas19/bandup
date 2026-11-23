export const pullRefreshPreviewPath = "/pull-refresh-debug";

export function isPullRefreshPreview() {
  return process.env.VERCEL_ENV === "preview";
}
