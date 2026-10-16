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
            title="Magic Hands"
            subtitle="Hand tracking"
            href="/games/magic-hands/"
            interactive
            footer={<Text tone="muted">Cast a spell →</Text>}
          >
            Your hands are the magic. Punch with boulder fists, throw fireballs,
            catch objects with a yank, push open portals, and cast lightning, farsight, and shields.
          </Card>
          <Card>
            title="3D Model Toybox"
            subtitle="Open the chest. Make a scene."
            href="/games/model-viewer/"
            interactive
            footer={<Text tone="muted">Open toybox →</Text>}
          >
            Rummage through 228 Kenney models and a set of originals. Preview
            toys, take out a handful, then grab, arrange, and toss them in VR.
          </Card>
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
          <Card
            title="Boundary Lab"
            href="/games/boundaries/"
            interactive
            footer={<Text tone="muted">Open lab →</Text>}
          >
            Read the headset boundary, test controller haptics, and grab a cube with tactile reach feedback.
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
