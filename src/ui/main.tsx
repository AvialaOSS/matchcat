import './figma-storage-shim';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, ThemeProvider, zhCN } from '@aviala-design/spiral';
import '@aviala-design/spiral/styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('MatchCat UI: #root missing');
}

createRoot(root).render(
  <ThemeProvider defaultMode="light">
    <ConfigProvider locale={zhCN} className="nc-root">
      <App />
    </ConfigProvider>
  </ThemeProvider>
);
