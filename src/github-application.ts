import { fetch as undiciFetch } from 'undici';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as jwt from 'jsonwebtoken';
import { PrivateKey } from './private-key.js';

export type ApplicationConfig = {
  applicationId: string,
  privateKey: string,
  baseApiUrl?: string,
  timeout?: number
}

export async function createApplication (config : ApplicationConfig): Promise<GitHubApplication> {
  const app = new GitHubApplication(config.privateKey, config.applicationId);
  await app.connect(config.timeout);
  return app;
}

export async function revokeAccessToken(token: string) {
  const client = getOctokit(token);

  try {
    const resp = await client.rest.apps.revokeInstallationAccessToken();
    if (resp.status === 204) {
      return true;
    }
    throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
  } catch (err: any) {
    throw new Error(`Failed to revoke application token; ${err.message}`);
  }
}

type GitHubApplicationConfig = {
  privateKey: PrivateKey,
  id: string,
}

type GitHubApplicationMetadata = {
  name: string,
  id: number,
  client_id: string,
}

type Permissions = {
  [key: string]: string;
}

export class GitHubApplication {

  private _client: any;

  private _metadata?: GitHubApplicationMetadata;

  private _config: GitHubApplicationConfig;

  constructor(privateKey, applicationId) {
    this._config = {
      privateKey: new PrivateKey(_validateVariableValue('privateKey', privateKey)),
      id: _validateVariableValue('applicationId', applicationId),
    };
  }

  async connect(validSeconds: number = 60): Promise<GitHubApplicationMetadata> {
    const self = this
      , secondsNow = Math.floor(Date.now() / 1000)
      , expireInSeconds = validSeconds
      ;

    const payload = {
      iat: secondsNow,
      exp: secondsNow + expireInSeconds,
      iss: this.id,
    };

    const token = jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
    this._client = getOctokit(token);

    core.debug(`Attempting to fetch GitHub Application for the provided credentials...`);
    try {
      const resp = await this.client.request('GET /app', {headers: {'X-GitHub-Api-Version': '2022-11-28'}});

      if (resp.status === 200) {
        self._metadata = resp.data;
        core.debug(`  GitHub Application resolved: ${JSON.stringify(resp.data)}`);
        return resp.data;
      } else {
        throw new Error(`Failed to load application with id:${this.id}; ${resp.data}`);
      }
    } catch (err: any) {
      const errorMessage = `Failure connecting as the application; status code: ${err.status}\n${err.message}`
      core.error(errorMessage);
      reportErrorDetails(err);
      throw new Error(errorMessage);
    }
  }

  get metadata() {
    return this._metadata;
  }

  get client() {
    const client = this._client;
    if (client === null) {
      throw new Error('Application has not been initialized correctly, call connect() to connect to GitHub first.');
    }
    return client;
  }

  get privateKey() {
    return this._config.privateKey.key;
  }

  get id() {
    return this._config.id;
  }

  get name(): string | undefined {
    return this._metadata?.name;
  }

  async getApplicationInstallations() {
    try {
      const resp = await this.client.request('GET /app/installations', {headers: {'X-GitHub-Api-Version': '2022-11-28'}});

      if (resp.status === 200) {
        return resp.data;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err: any) {
      const message = `Failed to get application installations; ${err.message}`;
      core.error(message);
      reportErrorDetails(err);

      throw new Error(message);
    }
  }

  async getRepositoryInstallation(owner: string, repo: string) {
    try {
      const resp = await this.client.rest.apps.getRepoInstallation({
        owner: owner,
        repo: repo,
        headers: {'X-GitHub-Api-Version': '2022-11-28'},
      });

      if (resp.status === 200) {
        return resp.data;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err: any) {
      const message = `Failed to resolve installation of application on repository ${owner}/${repo}; ${err.message}`;
      core.error(message);
      reportErrorDetails(err);

      throw new Error(message);
    }
  }

  async getOrganizationInstallation(org) {
    try {
      const resp = await this.client.rest.apps.getOrgInstallation({
        org: org,
        headers: {'X-GitHub-Api-Version': '2022-11-28'},
      });

      if (resp.status === 200) {
        return resp.data;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err: any) {
      const message = `Failed to resolve installation of application on organization ${org}; ${err.message}`;
      core.error(message);
      reportErrorDetails(err);

      throw new Error(message);
    }
  }

  async getInstallationAccessToken(installationId: number, permissions?: Permissions) {
    if (!installationId) {
      throw new Error('GitHub Application installation id must be provided');
    }

    const payload = {permissions: {}, headers: {'X-GitHub-Api-Version': '2022-11-28'}};
    if (permissions && Object.keys(permissions).length > 0) {
      payload.permissions = permissions;
    };

    try {
      const resp = await this.client.request(`POST /app/installations/${installationId}/access_tokens`, payload);

      if (resp.status === 201) {
        return resp.data;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch(err: any) {
      const message =`Failed to get access token for application installation; ${err.message}`
      core.error(message);
      reportErrorDetails(err);

      throw new Error(message);
    }
  }
}

function getOctokit(token: string, baseApiUrl?: string) {
  const baseUrl = getApiBaseUrl(baseApiUrl);

  const fetchClient = (url, options) => undiciFetch(url, options);

  const octokitOptions = {
    baseUrl: baseUrl,
    request: {
      fetch: fetchClient,
      timeout: 5000
    },
  };

  const client = github.getOctokit(token, octokitOptions);
  return client;
}

function _validateVariableValue(variableName: string, value?: string) {
  if (!value) {
    throw new Error(`A valid ${variableName} must be provided, was "${value}"`);
  }

  const result = `${value}`.trim();
  if (result.length === 0) {
    throw new Error(`${variableName} must be provided contained no valid characters other than whitespace`)
  }
  return result;
}

function getApiBaseUrl(url?: string): string {
  return url || process.env['GITHUB_API_URL'] || 'https://api.github.com'
}

function reportErrorDetails(err: any) {
  if (err) {
    core.startGroup('Error Details');
    core.info(`Response\n  status: ${err.response?.status}\n  url: ${err.response?.url}\n  headers: ${JSON.stringify(err.response?.headers)}`);
    core.endGroup();
  }
}
