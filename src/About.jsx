import { Layout, Container, Heading, Text, Link } from '@noahwright/design';
import { SiteHeader, SiteFooter } from './SiteChrome.jsx';

export function About() {
  return (
    <Layout header={<SiteHeader />} footer={<SiteFooter />}>
      <Container padding="xl" alignItems="center" itemSpacing="sm">
        <Heading level={1} align="center" gradient eyebrow="About">
          A busy engineer's VR playground
        </Heading>
        <Text align="center" tone="muted" balance>
          I'm Noah Wright — a software engineer who never had the spare time to
          properly dig into VR development, until AI tooling made it possible to
          actually ship something in the gaps between everything else. This site
          is that playground.
        </Text>
        <Text align="center" tone="muted">
          More of my side projects live at{' '}
          <Link href="https://noahwright.dev" isExternal>
            noahwright.dev
          </Link>
          .
        </Text>
      </Container>
    </Layout>
  );
}
