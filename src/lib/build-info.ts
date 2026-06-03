import { BUILD_INFO } from "@/generated/build-info";

export type BuildInfo = {
  commitSha: string;
  commitShort: string;
  deployId: string | null;
  buildTimestamp: string;
  serviceWorkerVersion: string;
};

export function getBuildInfo(): BuildInfo {
  return {
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || BUILD_INFO.commitSha,
    commitShort: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || BUILD_INFO.commitSha).slice(0, 12),
    deployId: process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID || BUILD_INFO.deployId,
    buildTimestamp: BUILD_INFO.buildTimestamp,
    serviceWorkerVersion: BUILD_INFO.serviceWorkerVersion
  };
}
