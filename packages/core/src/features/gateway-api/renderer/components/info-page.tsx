/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import styles from "./info-page.module.scss";

export interface InfoPageProps {
  message?: string;
}

export function InfoPage({ message }: InfoPageProps) {
  return (
    <div className={styles.infoPage}>
      <p className={styles.infoMessage}>{message}</p>
    </div>
  );
}
