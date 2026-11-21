/**
 * What to do if you meet an animal. Written for southern Africa first; every group also has general advice.
 * Matched on the scientific name: exact species first, then genus.
 */

export type Danger = 'danger' | 'caution'
export interface SafetyInfo { danger?: Danger; label?: string; tip: string; firstAid?: string }

export const SNAKEBITE_FIRST_AID =
  'Keep the person calm and still, and keep the bitten limb still. Take off rings and watches. Note the time and what the snake looked like (a photo from a safe distance helps), call for help and get to a hospital. Do not cut, suck, use a tourniquet or ice, and do not try to catch the snake. Venom in the eyes: rinse with lots of water or any bland liquid.'

const SNAKE_TIP = 'Stop and stay still, then back away slowly and give it plenty of space (at least 3 m). Most snakes move off if left alone. Never try to catch, kill or photograph it up close. Wear boots, watch where you step and put your hands, and use a torch at night.'

const BY_NAME: Record<string, SafetyInfo> = {
  // Snakes
  'Bitis arietans': { danger: 'danger', label: 'Venomous', tip: 'Puff adders rely on camouflage and often lie still on or beside paths instead of moving away. Watch the ground, step around at a wide distance and never step over one.', firstAid: SNAKEBITE_FIRST_AID },
  'Bitis atropos': { danger: 'danger', label: 'Venomous', tip: 'Berg adders are common in the Drakensberg grasslands and rocky slopes and are easy to miss. Watch your feet and hands on rocky ground; back away slowly.', firstAid: SNAKEBITE_FIRST_AID },
  Bitis: { danger: 'danger', label: 'Venomous', tip: 'Adders are slow and well camouflaged, so they are easy to step on. Watch the path and give them a wide berth.', firstAid: SNAKEBITE_FIRST_AID },
  'Hemachatus haemachatus': { danger: 'danger', label: 'Venomous, spits', tip: 'Rinkhals rear up and spit venom at the eyes, and sometimes play dead. Turn your face away, protect your eyes (sunglasses help) and back off. Leave a "dead" one alone.', firstAid: SNAKEBITE_FIRST_AID },
  Naja: { danger: 'danger', label: 'Venomous', tip: 'Cobras rear up and spread a hood; some species spit at the eyes. Keep still, protect your eyes and back away slowly once it lowers its head.', firstAid: SNAKEBITE_FIRST_AID },
  Dendroaspis: { danger: 'danger', label: 'Highly venomous', tip: 'Mambas are fast but shy and will usually escape if given a clear route. Freeze, then move away slowly; never block its escape path.', firstAid: SNAKEBITE_FIRST_AID },
  'Dispholidus typus': { danger: 'danger', label: 'Venomous', tip: 'Boomslangs live in trees and bushes and are reluctant to bite unless handled. Look up as well as down in thick bush and leave it alone.', firstAid: SNAKEBITE_FIRST_AID },
  Thelotornis: { danger: 'danger', label: 'Venomous', tip: 'Vine (twig) snakes are almost invisible in branches. Do not push through bush with your hands; back away if you see one.', firstAid: SNAKEBITE_FIRST_AID },
  Aspidelaps: { danger: 'danger', label: 'Venomous', tip: 'Shield-nose and coral snakes are mostly active at night. Use a torch and back away.', firstAid: SNAKEBITE_FIRST_AID },
  Causus: { danger: 'caution', label: 'Mildly venomous', tip: 'Night adders bite readily if stepped on. Watch where you walk, especially near water and at night.', firstAid: SNAKEBITE_FIRST_AID },
  Atractaspis: { danger: 'caution', label: 'Venomous', tip: 'Stiletto snakes cannot be held safely, even behind the head. Never pick up any small dark snake.', firstAid: SNAKEBITE_FIRST_AID },
  // Scorpions and spiders
  Parabuthus: { danger: 'danger', label: 'Dangerous sting', tip: 'Thick-tailed scorpions with small pincers are the dangerous ones. Shake out boots, clothes and sleeping bags, and don\'t lift rocks with bare hands. Some species squirt venom: protect your eyes.', firstAid: 'Keep calm, keep the person still and get medical help, especially for children. Call the Poison Information Helpline for advice.' },
  Hottentotta: { danger: 'caution', label: 'Painful sting', tip: 'Shake out boots and clothes, and don\'t lift rocks with bare hands.' },
  Opistophthalmus: { danger: 'caution', label: 'Painful sting', tip: 'Burrowing scorpions with big pincers have mild venom, but the sting hurts. Don\'t dig or lift rocks with bare hands.' },
  Latrodectus: { danger: 'danger', label: 'Venomous bite', tip: 'Button (widow) spiders hide under rocks, logs and in old buildings. Shake out gear and look before you grab.', firstAid: 'Keep the person calm, note the time and get to a hospital; antivenom exists. Call the Poison Information Helpline for advice.' },
  Sicarius: { danger: 'caution', label: 'Venomous bite', tip: 'Six-eyed sand spiders bury themselves in sand. Don\'t put your hands in sand under rocks.' },
  Loxosceles: { danger: 'caution', label: 'Venomous bite', tip: 'Violin spiders can cause slow-healing wounds. Shake out clothes and bedding.' },
  // Insects
  'Apis mellifera': { danger: 'caution', label: 'Stings', tip: 'If bees become aggressive, walk or run away quickly and keep going, cover your face and get into a car or building. Don\'t swat or jump into water. Scrape stings out sideways.', firstAid: 'Watch for swelling of the face or throat, or trouble breathing: that is an emergency, call for help immediately.' },
  // Mammals
  'Papio ursinus': { danger: 'caution', label: 'Can be aggressive', tip: 'Never feed baboons or carry food where they can see it. Keep bags closed, avoid eye contact, give them space and don\'t block their way. If one grabs something, let it go.' },
  'Syncerus caffer': { danger: 'danger', label: 'Dangerous', tip: 'Buffalo, especially lone bulls, can charge without warning. Keep well away; if one approaches, move behind a large tree or rock.' },
  Loxodonta: { danger: 'danger', label: 'Dangerous', tip: 'Give elephants a very wide berth and never get between a mother and calf. Back away quietly if one flaps its ears or shakes its head.' },
  'Panthera leo': { danger: 'danger', label: 'Dangerous', tip: 'Never run. Stand tall, face the lion, make yourself big and loud, and back away slowly.' },
  'Panthera pardus': { danger: 'danger', label: 'Dangerous', tip: 'Leopards almost always avoid people. If you see one, don\'t run or approach: stand tall, keep facing it and back away slowly.' },
  'Hippopotamus amphibius': { danger: 'danger', label: 'Dangerous', tip: 'Never get between a hippo and the water, and stay away from riverbanks at dusk and night.' },
  Diceros: { danger: 'danger', label: 'Dangerous', tip: 'Rhinos see poorly but charge at threats. Move quietly downwind and put a big tree between you and it.' },
  Ceratotherium: { danger: 'danger', label: 'Dangerous', tip: 'Keep your distance and move quietly downwind; get behind a large tree if it approaches.' },
  'Crocuta crocuta': { danger: 'caution', label: 'Keep away', tip: 'Don\'t leave food out at camp. Stand your ground, make noise and don\'t run.' },
  'Crocodylus niloticus': { danger: 'danger', label: 'Dangerous', tip: 'Stay well back from the water\'s edge in rivers, dams and pans; never swim or wash in crocodile areas.' },
  'Taurotragus oryx': { tip: 'Eland are shy and usually move off. Enjoy them from a distance and don\'t approach calves.' },
  'Pelea capreolus': { tip: 'Grey rhebok are wary grassland antelope. Stay quiet and keep your distance.' },
  'Gypaetus barbatus': { tip: 'Bearded vultures are endangered. Watch from a distance and keep away from cliffs where they nest; report sightings to Ezemvelo.' },
}

const BY_GROUP: Record<string, SafetyInfo> = {
  Mammalia: { tip: 'Keep your distance, never feed wild animals and never get between a mother and her young. If an animal reacts to you, back away slowly; don\'t run.' },
  Aves: { tip: 'Watch from a distance and don\'t disturb nests or chicks.' },
  Reptilia: { tip: 'Leave reptiles alone and don\'t handle them. Watch where you put your hands and feet on rocks.' },
  Amphibia: { tip: 'Don\'t handle frogs (sunscreen and insect repellent harm them). Wash your hands if you touch one.' },
  Insecta: { tip: 'Most insects are harmless. Don\'t handle hairy caterpillars, and move away from swarming bees or wasps.' },
  Arachnida: { tip: 'Shake out boots, clothes and sleeping bags, and don\'t put bare hands under rocks or logs.' },
  Plantae: { tip: 'Don\'t eat wild plants or berries, and don\'t pick protected plants.' },
  Fungi: { tip: 'Never eat wild mushrooms: some deadly ones look like edible ones.' },
}

export function safetyFor(name: string, group: string, snake?: boolean): SafetyInfo {
  const genus = name.split(' ')[0]
  const hit = BY_NAME[name] ?? BY_NAME[genus]
  if (hit) return hit
  if (snake) return { danger: 'caution', label: 'Snake', tip: SNAKE_TIP + ' Treat any snake you can\'t identify as venomous.', firstAid: SNAKEBITE_FIRST_AID }
  return BY_GROUP[group] ?? { tip: 'Enjoy it from a distance and leave it as you found it.' }
}
