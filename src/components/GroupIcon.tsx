import { Bird, Bug, Droplets, Flower2, PawPrint, Search, Sprout, Turtle, Worm, type LucideProps } from 'lucide-react'

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Mammalia: PawPrint, Aves: Bird, Reptilia: Turtle, Amphibia: Droplets, Insecta: Bug, Arachnida: Bug, Plantae: Flower2, Fungi: Sprout, snakes: Worm,
}

/** Icon for an iNaturalist group (mammals, birds, ...). */
export default function GroupIcon({ group, ...p }: { group: string } & LucideProps) {
  const I = ICONS[group] ?? Search
  return <I {...p} />
}
