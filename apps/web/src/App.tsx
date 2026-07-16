import { BookOpen, Highlighter, Inbox, Plus, Search } from 'lucide-react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { HighlightsPage } from './pages/HighlightsPage';
import { AddLinkDialog } from './components/AddLinkDialog';

export function App() {
  const [addOpen, setAddOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const inReader = location.pathname.startsWith('/item/');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('/')} aria-label="Open library">
          <span className="brand-mark"><BookOpen size={18} strokeWidth={2.2} /></span>
          <span>Revisit</span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Inbox size={18} />
            Library
          </NavLink>
          <NavLink to="/highlights" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Highlighter size={18} />
            Highlights
          </NavLink>
        </nav>

        <button className="add-button" onClick={() => setAddOpen(true)}>
          <Plus size={18} />
          Add link
        </button>

        <div className="sidebar-note">
          <Search size={15} />
          Search titles, article text, notes and highlights from the Library.
        </div>
      </aside>

      <main className={`main-content ${inReader ? 'reader-route' : ''}`}>
        <Routes>
          <Route path="/" element={<LibraryPage onAdd={() => setAddOpen(true)} />} />
          <Route path="/item/:id" element={<ReaderPage />} />
          <Route path="/highlights" element={<HighlightsPage />} />
        </Routes>
      </main>

      <AddLinkDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={(id) => navigate(`/item/${id}`)} />
    </div>
  );
}
