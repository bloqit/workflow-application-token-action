import * as core from '@actions/core';
import { createApplication, GitHubApplication } from '../github-application.js';

async function run() {
  let app: GitHubApplication;

  try {
    const privateKey = getRequiredInputValue('application_private_key');
    const applicationId = getRequiredInputValue('application_id');

    core.setSecret(privateKey);

    if (!/^[0-9]+$/.test(applicationId)) {
      throw new Error('Invalid application ID format. It must be a numeric string.');
    }

    app = await createApplication({
      privateKey,
      applicationId,
    });
  } catch (err) {
    fail(err, 'Failed to initialize GitHub Application connection using provided ID and private key');
    return;
  }

  if (app) {
    core.info(`Found GitHub Application: ${app.name}`);

    try {
      const repository = process.env['GITHUB_REPOSITORY'];

      if (!repository || !repository.includes('/')) {
        throw new Error(`Invalid GITHUB_REPOSITORY format. Expected 'owner/repo'.`);
      }

      const [owner, repo] = repository.split('/');
      let installationId;

      core.info(`Obtaining application installation for repository: ${repository}`);
      const installation = await app.getRepositoryInstallation(owner, repo);
      installationId = installation?.id || fail(undefined, `GitHub Application is not installed on repository: ${repository}`);

      if (installationId) {
        const accessToken = await app.getInstallationAccessToken(installationId);

        core.setSecret(accessToken.token);
        core.setOutput('token', accessToken.token);
        core.info('Successfully generated an access token for the application.');

        core.saveState('token', accessToken.token);

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
