import logoSvg from '../assets/noah-vr.svg?raw';

// A single trusted SVG source serves both the header and the favicon. In the
// header its parts are painted by the site's live theme instead of OS colors.
const headerSvg = logoSvg.replace(/<style>[\s\S]*?<\/style>/, '');

export function Logo() {
  return <span className="site-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: headerSvg }} />;
}
