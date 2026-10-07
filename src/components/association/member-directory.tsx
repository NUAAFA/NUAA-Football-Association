import styles from "./association.module.css";

type MemberDirectoryProps = {
  positions: readonly { readonly role: string; readonly name: string }[];
};

export function MemberDirectory({ positions }: MemberDirectoryProps) {
  return (
    <dl className={styles.memberDirectory}>
      {positions.map((item, index) => (
        <div key={`${item.role}-${item.name}-${index}`}>
          <dt>{item.role}</dt>
          <dd>{item.name}</dd>
        </div>
      ))}
    </dl>
  );
}
