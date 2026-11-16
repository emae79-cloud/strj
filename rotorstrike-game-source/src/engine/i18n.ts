import tr from '../i18n/tr.json'

/**
 * Oyun tek dillidir (Türkçe). Tarayıcı dili, sistem dili veya kayıtlı seçim metinleri değiştirmez;
 * sözlük sabittir ve eksik anahtar görünür olsun diye anahtarın kendisiyle yazılır.
 */
export type Dictionary = Record<string, string>
export const DICTIONARY: Dictionary = tr

export class I18n {
  readonly locale = 'tr-TR'

  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = DICTIONARY[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }

  /** Metinler sabit; arayüz yeniden çizimi için dinleyici tutulur. */
  onChange(): () => void {
    return () => undefined
  }
}
