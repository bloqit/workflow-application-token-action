import * as core from '@actions/core';
import { createApplication, GitHubApplication } from '../github-application.js';

async function run() {
  let app: GitHubApplication;

  try {
    const privateKey = getRequiredInputValue('application_private_key');
    const applicationId = getRequiredInputValue('application_id');
    const githubApiBaseUrl = core.getInput('github_api_base_url');
    const httpsProxy = core.getInput('https_proxy');
    const ignoreProxy = core.getBooleanInput('ignore_environment_proxy');

    core.setSecret(privateKey);

    if (!/^[0-9]+$/.test(applicationId)) {
      throw new Error('Invalid application ID format. It must be a numeric string.');
    }

    app = await createApplication({
      privateKey,
      applicationId,
      baseApiUrl: githubApiBaseUrl,
      proxy: validateProxy(httpsProxy),
      ignoreEnvironmentProxy: ignoreProxy
    });
  } catch (err) {
    fail(err, 'Failed to initialize GitHub Application connection using provided ID and private key');
    return;
  }

  if (app) {
    core.info(`Found GitHub Application: ${app.name}`);

    try {
      const userSpecifiedOrganization = core.getInput('organization');
      const repository = process.env['GITHUB_REPOSITORY'];

      if (!repository || !repository.includes('/')) {
        throw new Error(`Invalid GITHUB_REPOSITORY format. Expected 'owner/repo'.`);
      }

      const [owner, repo] = repository.split('/');
      let installationId;

      if (userSpecifiedOrganization) {
        core.info(`Obtaining application installation for organization: ${userSpecifiedOrganization}`);
        const installation = await app.getOrganizationInstallation(userSpecifiedOrganization);
        installationId = installation?.id || fail(undefined, `GitHub Application is not installed on the specified organization: ${userSpecifiedOrganization}`);
      } else {
        core.info(`Obtaining application installation for repository: ${repository}`);
        const installation = await app.getRepositoryInstallation(owner, repo);
        installationId = installation?.id || fail(undefined, `GitHub Application is not installed on repository: ${repository}`);
      }

      if (installationId) {
        const permissions = parsePermissions(core.getInput("permissions"));
        core.info(`Requesting GitHub Application token with permissions: ${JSON.stringify(permissions)}`);

        const accessToken = await app.getInstallationAccessToken(installationId, permissions);

        core.setSecret(accessToken.token);
        core.setOutput('token', accessToken.token);
        core.info('Successfully generated an access token for the application.');

        if (core.getBooleanInput('revoke_token')) {
          core.saveState('token', accessToken.token);
        }
      } else {
        fail(undefined, 'No installation of the specified GitHub application was retrieved.');
      }
    } catch (err) {
      fail(err);
    }
  }
}
run();

function fail(err: any, message?: string) {
  if (err) {
    core.error(err);
    core.debug(err.stack);
  }
  core.setFailed(message || err?.message || 'An unknown error occurred');
}

function getRequiredInputValue(key: string) {
  return core.getInput(key, { required: true }).trim();
}

function parsePermissions(permissionInput: string) {
  const permissions = {};
  if (permissionInput) {
    for (const p of permissionInput.split(",")) {
      const [pName, pLevel] = p.split(":", 2);
      if (pName && pLevel) {
        permissions[pName.trim()] = pLevel.trim();
      }
    }
  }
  return Object.keys(permissions).length > 0 ? permissions : { contents: 'read' }; 
}

function validateProxy(proxy: string | undefined) {
  if (proxy && !/^https?:\/\//.test(proxy)) {
    throw new Error('Invalid proxy URL format. It must start with http:// or https://');
  }
  return proxy;
}
