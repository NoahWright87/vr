import { Layout, Container, Heading, Text, Card, CardGrid } from '@noahwright/design';
import { SiteHeader, SiteFooter } from './SiteChrome.jsx';

// Everything on the site, in three groups. Every page gets a card in one
// of them — nothing lives in a footnote link.
const GROUPS = [
  {
    title: 'Games',
    cards: [
      {
        title: 'Pistols at Dawn',
        subtitle: 'The flagship',
        href: '/games/pistols-at-dawn/',
        cta: 'Play →',
        body: 'Duel, raid a saloon, and burn it down. The biggest sandbox here — bring a headset and see what breaks.',
      },
      {
        title: 'Magic Hands',
        subtitle: 'Hand tracking',
        href: '/games/magic-hands/',
        cta: 'Cast a spell →',
        body: 'Your hands are the magic. Punch with boulder fists, throw fireballs, catch objects with a yank, spread open portals, raise skeleton minions, and cast lightning, farsight, and shields.',
      },
    ],
  },
  {
    title: 'Proofs of concept',
    cards: [
      {
        title: 'Impossible Spaces',
        href: '/games/impossible-spaces/',
        cta: 'Explore →',
        body: 'Walk a maze larger than your real room. Colored spaces overlap, and stationary elevators change the world behind closed doors.',
      },
      {
        title: 'Impossible Spaces · 2D',
        subtitle: 'Phone & laptop playground',
        href: '/games/impossible-spaces/playground/',
        cta: 'Draw & generate →',
        body: 'Extend a square on a metre grid, generate inside your full boundary, and explore overlapping rooms without a headset.',
      },
      {
        title: 'Expansive Spaces',
        href: '/games/expansive-spaces/',
        cta: 'Explore →',
        body: 'Compare virtual room sizes with your play space and a live boundary map. A lab for making small spaces feel bigger.',
      },
      {
        title: 'Punch Pop',
        href: '/games/punch-pop/',
        cta: 'Play →',
        body: 'No joystick. Your fists are the controller — swing, uppercut, and smash your way through.',
      },
      {
        title: 'Cube Pop',
        href: '/games/cube-pop/',
        cta: 'Play →',
        body: 'Point, shoot, pop. A quick warm-up for getting used to VR controls.',
      },
    ],
  },
  {
    title: 'Building blocks',
    cards: [
      {
        title: 'Menus & HUD',
        subtitle: 'Crossbar menus, watch, visor',
        href: '/primitives/menus/',
        cta: 'Take the tour →',
        body: 'A guided tour from where you stand: pick a shooter, racing, fantasy or frontier demo and its HUD, props that open menus, and a scene to try them in.',
      },
      {
        title: 'Multiplayer',
        subtitle: 'Peer-to-peer rooms',
        href: '/primitives/multiplayer/',
        cta: 'Host a room →',
        body: 'Host or join by room code from the watch, then grab and throw shared boxes with everyone in the room.',
      },
      {
        title: 'Action Lab',
        subtitle: 'Combat primitives',
        href: '/primitives/actions/',
        cta: 'Open lab →',
        body: 'Feel like John Wick without being that talented: throwing, guns, guards and melee, where how you move is the input and every assist is earned.',
      },
      {
        title: 'Boundary Lab',
        subtitle: 'Play space & haptics',
        href: '/games/boundaries/',
        cta: 'Open lab →',
        body: 'Walk or paint a floor boundary, then generate rooms in that same VR session. Also includes controller haptics tests.',
      },
      {
        title: '3D Model Toybox',
        subtitle: 'Models & grabbing',
        href: '/games/model-viewer/',
        cta: 'Open toybox →',
        body: 'Rummage through 228 Kenney models and a set of originals. Preview toys, take out a handful, then grab, arrange, and toss them in VR.',
      },
    ],
  },
];

export function App() {
  return (
    <Layout header={<SiteHeader />} footer={<SiteFooter />}>
      <Container padding="xl" alignItems="center" itemSpacing="sm">
        <Text align="center" tone="muted" balance>
          Experimental WebXR games built for the Quest 2 browser. No app store, no
          install — open a link and go.
        </Text>
      </Container>

      {GROUPS.map((group) => (
        <Container key={group.title} padding="lg" itemSpacing="md">
          {/* Styled as the page's title would be: centred, Wright Sans, the
              brand gradient, at h1 size (site.css) while staying an h2. */}
          <div className="site-section-heading">
            <Heading level={2} align="center" gradient>
              {group.title}
            </Heading>
          </div>
          <CardGrid gap="lg" minCardWidth="340px">
            {group.cards.map((card) => (
              <Card
                key={card.href}
                title={card.title}
                subtitle={card.subtitle}
                href={card.href}
                interactive
                footer={<Text tone="muted">{card.cta}</Text>}
              >
                {card.body}
              </Card>
            ))}
          </CardGrid>
        </Container>
      ))}
    </Layout>
  );
}
