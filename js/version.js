/** Version reported when `version.json` is unavailable. */
export const DEV_VERSION = 'dev';

/**
 * The running editor's version.
 * @typedef {object} VersionInfo
 * @property {string} editorVersion Version without a leading `v`, or `dev`.
 * @property {string} label Text for the viewport version label.
 */

const DEV_INFO = Object.freeze({ editorVersion: DEV_VERSION, label: DEV_VERSION });

/**
 * Reads `version.json` through the given fetch. Never rejects: any failure gives `dev`.
 * @param {(url: string, init?: object) => Promise<{ ok: boolean, json: () => Promise<*> }>} fetchFn Fetch function.
 * @returns {Promise<VersionInfo>} The version info.
 */
export async function loadVersion(fetchFn) {
  try {
    const response = await fetchFn('version.json', { cache: 'no-store' });
    if (!response.ok) return DEV_INFO;
    const { version, commit } = await response.json();
    if (typeof version !== 'string' || version === '') return DEV_INFO;
    const editorVersion = version.startsWith('v') ? version.slice(1) : version;
    if (editorVersion === '') return DEV_INFO;
    const label = typeof commit === 'string' && commit !== '' ? `${version} · ${commit}` : version;
    return Object.freeze({ editorVersion, label });
  } catch {
    return DEV_INFO;
  }
}
