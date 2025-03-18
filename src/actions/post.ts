import * as core from '@actions/core';
import { revokeAccessToken } from '../github-application.js';

async function revokeToken() {
  try {
    const token = core.getState('token');

    if (!token) {
      core.info(`No valid token stored in the action state, nothing to revoke.`);
      return;
    }

    // Mask the token to prevent exposure in logs
    core.setSecret(token);

    const revokeToken = core.getBooleanInput('revoke_token');
    if (!revokeToken) {
      core.info(`GitHub Application revocation skipped. Token will expire automatically.`);
      return;
    }

    core.info(`Performing GitHub Application token revocation...`);

    const baseUrl = core.getInput('github_api_base_url');


    const revoked = await revokeAccessToken(token, baseUrl);

    if (revoked) {
      core.info(`Token has been successfully revoked.`);
    } else {
      throw new Error('Failed to revoke the application token. See logs for more details.');
    }
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    core.setFailed(`Failed to revoke GitHub Application token: ${errorMessage}`);
  }
}

revokeToken();