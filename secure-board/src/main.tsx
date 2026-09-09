import { createRoot } from 'react-dom/client';
import { IndexedDbSessionStore } from './auth/session';
import { loadRuntimeConfig } from './config';
import { MatrixBoardService } from './matrix/service';
import { App } from './ui/App';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

loadRuntimeConfig()
  .then(({ homeserverUrl }) => {
    const service = new MatrixBoardService(homeserverUrl, new IndexedDbSessionStore());
    root.render(<App service={service} />);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown configuration error';
    root.render(<main className="gate"><section className="login-card"><p className="eyebrow">CONFIGURATION ERROR</p><h1>BOARD<br /><span>OFFLINE</span></h1><p role="alert" className="error">{message}</p></section></main>);
  });
