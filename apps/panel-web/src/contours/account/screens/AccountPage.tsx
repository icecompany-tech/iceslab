import { PasswordCard } from '@/contours/account/components/PasswordCard'
import { TokensCard } from '@/contours/account/components/TokensCard'
import { TwoFactorCard } from '@/contours/account/components/TwoFactorCard'
import styles from '@/contours/account/components/account.module.css'
import { DICT } from '@/contours/account/dict'
import { useDict } from '@/lib/i18n'

export default function AccountPage() {
  const words = useDict(DICT)
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{words.title}</h1>
      <TokensCard />
      <div className={styles.columns}>
        <PasswordCard />
        <TwoFactorCard />
      </div>
    </div>
  )
}
