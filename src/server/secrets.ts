import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  async get(name: string) {
    return process.env[name];
  }
}

export class GoogleSecretManagerProvider implements SecretProvider {
  private readonly client = new SecretManagerServiceClient();
  constructor(private readonly projectId: string) {}

  async get(name: string) {
    const secretName = `projects/${this.projectId}/secrets/${name}/versions/latest`;
    const [version] = await this.client.accessSecretVersion({ name: secretName });
    return version.payload?.data?.toString();
  }
}

export class FileSecretProvider implements SecretProvider {
  constructor(private readonly root = process.env.SECRET_FILE_DIRECTORY || "/run/secrets") {}

  async get(name: string) {
    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(name)) throw new Error("Invalid secret name.");
    const target = path.resolve(this.root, name);
    if (path.dirname(target) !== path.resolve(this.root)) throw new Error("Secret path escaped configured directory.");
    try { return (await readFile(target, "utf8")).trim() || undefined; }
    catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error; }
  }
}

export function createSecretProvider(): SecretProvider {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const provider = process.env.SECRET_PROVIDER || (process.env.USE_SECRET_MANAGER === "true" ? "GCP_SECRET_MANAGER" : "ENVIRONMENT");
  if (provider === "GCP_SECRET_MANAGER") {
    if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT is required for GCP_SECRET_MANAGER.");
    return new GoogleSecretManagerProvider(projectId);
  }
  if (provider === "FILE") return new FileSecretProvider();
  if (provider !== "ENVIRONMENT") throw new Error(`Unsupported SECRET_PROVIDER ${provider}.`);
  return new EnvironmentSecretProvider();
}
