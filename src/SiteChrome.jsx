import { Header, Footer, Heading, Text, Link } from '@noahwright/design';

export function SiteHeader() {
  return (
    <Header
      left={
        <Link href="/" variant="subtle">
          <Heading level={2} gradient>
            WebXR Lab
          </Heading>
        </Link>
      }
      right={<Link href="/primitives/menus/" variant="subtle">Primitives ↗</Link>}
    />
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <Footer
      bottom={
        <Text align="center" tone="muted">
          Built with A-Frame, for the Meta Quest 2 browser · ©{' '}
          {year} <Link href="/about/" variant="subtle">Noah Wright</Link>
        </Text>
      }
    />
  );
}
