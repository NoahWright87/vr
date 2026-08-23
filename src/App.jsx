import { Layout, Container, Heading, Text, Link, Card, CardGrid } from '@noahwright/design';
import { SiteHeader, SiteFooter } from './SiteChrome.jsx';

export function App() {
  return (
    <Layout header={<SiteHeader />} footer={<SiteFooter />}>
      <Container padding="xl" alignItems="center" itemSpacing="sm">
        <Heading level={1} align="center" gradient eyebrow="Meta Quest 2 · WebXR">
          Strap in and play
        </Heading>
        <Text align="center" tone="muted" balance>
          Experimental WebXR games built for the Quest 2 browser. No app store, no
          install — open a link and go.
        </Text>
      </Container>

      <Container padding="lg">
        <CardGrid gap="lg" minCardWidth="340px">
          <Card
            title="Pistols at Dawn"
            subtitle="The flagship"
            href="/games/pistols-at-dawn/"
            interactive
            footer={<Text tone="muted">Play →</Text>}
          >
            Duel, raid a saloon, and burn it down. The biggest sandbox here — bring
            a headset and see what breaks.
          </Card>
          <Card
            title="Punch Pop"
            href="/games/punch-pop/"
            interactive
            footer={<Text tone="muted">Play →</Text>}
          >
            No joystick. Your fists are the controller — swing, uppercut, and smash
            your way through.
          </Card>
          <Card
            title="Cube Pop"
            href="/games/cube-pop/"
            interactive
            footer={<Text tone="muted">Play →</Text>}
          >
            Point, shoot, pop. A quick warm-up for getting used to VR controls.
          </Card>
        </CardGrid>
      </Container>

      <Container padding="lg" alignItems="center">
        <Text align="center" tone="muted">
          Also here: a{' '}
          <Link href="/primitives/menus/">showcase of the interaction building blocks</Link>{' '}
          these games are made from.
        </Text>
      </Container>
    </Layout>
  );
}
