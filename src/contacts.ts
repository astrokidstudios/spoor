import { Capacitor } from '@capacitor/core'
import { Contacts, type PhonePayload } from '@capacitor-community/contacts'
import { db, uid, type Contact } from './db'

/** Picking from the phone's address book needs the native app (Safari has no contact picker). */
export const canPickContacts = Capacitor.isNativePlatform()

const digits = (p: string) => p.replace(/[^\d+]/g, '')
/** Compare numbers loosely, so +27 82… and 082… count as the same person. */
const same = (a: string, b: string) => !!a && !!b && digits(a).slice(-9) === digits(b).slice(-9)

/** The best number to send to: a mobile if there is one, else the primary, else the first. */
function bestPhone(phones: PhonePayload[] = []) {
  const withNum = phones.filter((p) => p.number)
  return (withNum.find((p) => p.type === 'mobile') ?? withNum.find((p) => p.isPrimary) ?? withNum[0])?.number ?? ''
}

/** Open the iPhone contact picker and save the chosen person to Trailz (or return them if already saved). */
export async function pickFromPhone(): Promise<Contact | null> {
  const res = await Contacts.pickContact({ projection: { name: true, phones: true } }).catch((e: Error) => {
    if (/cancel/i.test(e.message)) return null
    throw e
  })
  const c = res?.contact
  if (!c) return null
  const name = c.name?.display || [c.name?.given, c.name?.family].filter(Boolean).join(' ') || 'Contact'
  const phone = digits(bestPhone(c.phones))
  return saveContact(name, phone)
}

/** Add a contact, or reuse the saved one with the same number. */
export async function saveContact(name: string, phone: string): Promise<Contact> {
  const all = await db.contacts.toArray()
  const existing = all.find((x) => (phone && same(x.phone, phone)) || (!phone && !x.phone && x.name.toLowerCase() === name.toLowerCase()))
  if (existing) {
    if (existing.name !== name && name) await db.contacts.update(existing.id, { name })
    return { ...existing, name: name || existing.name }
  }
  const c: Contact = { id: uid(), name, phone: digits(phone) }
  await db.contacts.add(c)
  return c
}

/** Favourites first, then the people you shared with most recently, then everyone else A–Z. */
export function sortContacts(list: Contact[]) {
  return [...list].sort((a, b) =>
    Number(!!b.favourite) - Number(!!a.favourite) ||
    (b.lastSharedAt ?? 0) - (a.lastSharedAt ?? 0) ||
    a.name.localeCompare(b.name))
}

export const markShared = (id: string) => db.contacts.where('id').equals(id).modify((c) => { c.lastSharedAt = Date.now(); c.shareCount = (c.shareCount ?? 0) + 1 })
export const toggleFavourite = (c: Contact) => db.contacts.update(c.id, { favourite: !c.favourite })

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
