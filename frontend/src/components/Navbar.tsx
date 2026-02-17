import { Link, useLocation } from 'react-router-dom';
import './Navbar.css';

function Navbar() {
  const location = useLocation();

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          <span className="navbar-logo">⚡</span>
          <span className="navbar-title">Homelab Builder</span>
        </Link>
        <div className="navbar-links">
          <Link
            to="/"
            className={`navbar-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            Home
          </Link>
          <Link
            to="/services"
            className={`navbar-link ${location.pathname === '/services' ? 'active' : ''}`}
          >
            Services
          </Link>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
