// corvid documentation site — Astro Starlight.
//
// Two build shapes (see .github/workflows/):
//   current build (default):  base = /docs/            -> deployed at the site root
//   version snapshot build:   SITE_VERSION=0.2.1 SITE_BASE=/docs/v0.2.1/
//                            -> deployed under /docs/vX.Y.Z/
// SITE_VERSION also drives the version banner every page carries.

const SITE_URL = 'https://corvid-db.github.io';
const version = process.env.SITE_VERSION || ''; // '' = current (tracks master)
const base = process.env.SITE_BASE || '/docs';

// @ts-check
/** @type {import('astro').AstroUserConfig} */
export default {
  site: SITE_URL,
  base,
  integrations: [
    (await import('@astrojs/starlight')).default({
      title: 'corvid',
      description:
        'Documentation for corvid — an embedded, multi-modal data store for AI applications: vector search, full-text search, filters, rank fusion, graph, geo and TTL in one in-process engine.',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: 'favicon.svg',
      // Global version banner — every page, release-sensitive content included.
      components: {
        Banner: './src/components/VersionBanner.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'corvid-db/docs on GitHub',
          href: 'https://github.com/corvid-db/docs',
        },
      ],
      sidebar: [
        { label: 'Start', items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Tutorial', items: [{ autogenerate: { directory: 'tutorial' } }] },
        { label: 'The corvid language', items: [{ autogenerate: { directory: 'language' } }] },
        { label: 'Indexes', items: [{ autogenerate: { directory: 'indexes' } }] },
        { label: 'Full-text search', items: [{ autogenerate: { directory: 'fts' } }] },
        { label: 'Graph', items: [{ autogenerate: { directory: 'graph' } }] },
        { label: 'Geo', items: [{ autogenerate: { directory: 'geo' } }] },
        { label: 'Integrity & events', items: [{ autogenerate: { directory: 'integrity' } }] },
        { label: 'Administration', items: [{ autogenerate: { directory: 'admin' } }] },
        { label: 'Performance', items: [{ autogenerate: { directory: 'performance' } }] },
        { label: 'The C ABI', items: [{ autogenerate: { directory: 'ffi' } }] },
        { label: 'Bindings', items: [{ autogenerate: { directory: 'bindings' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'About', items: [{ autogenerate: { directory: 'about' } }] },
      ],
      customCss: ['./src/styles/custom.css'],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      plugins: [],
    }),
  ],
  build: { format: 'directory' },
  markdown: {
    remarkPlugins: [[(await import('./plugins/remark-base-paths.mjs')).remarkBasePaths, {}]],
  },
};
