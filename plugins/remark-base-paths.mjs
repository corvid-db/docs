// Remark plugin: rewrite root-relative content links to include the site
// base path, so the same markdown serves the current build (/docs/) and
// version snapshots (/docs/vX.Y.Z/) with in-snapshot navigation.
//
// - '/language/values/'      -> '${BASE}/language/values/'
// - '/docs/...'              -> unchanged (already canonical, always current site)
// - '/docs/v0.2.1/...'       -> unchanged (cross-version links are explicit)
// - external, anchor-only, relative links -> unchanged.

const BASE = (process.env.SITE_BASE || '/docs').replace(/\/$/, '');

export function remarkBasePaths() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        const url = node.url;
        if (
          url.startsWith('/') &&
          !url.startsWith('//') &&
          !url.startsWith(BASE + '/') &&
          url !== BASE
        ) {
          node.url = BASE + url;
        }
      }
      for (const child of node.children || []) visit(child);
    };
    visit(tree);
  };
}
