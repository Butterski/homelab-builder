import { Link } from 'react-router-dom';
import './HomePage.css';

function HomePage() {
  return (
    <div className="home-page">
      <section className="hero">
        <h1 className="hero-title">
          Build Your Perfect{' '}
          <span className="gradient-text">Homelab</span>
        </h1>
        <p className="hero-subtitle">
          Select the services you want to run, get hardware recommendations,
          and generate a shopping list — all in one place.
        </p>
        <div className="hero-actions">
          <Link to="/services" className="btn-primary btn-large">
            Browse Services
          </Link>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <span className="feature-icon">📋</span>
          <h3>Service Catalog</h3>
          <p>Browse 10+ popular homelab services with detailed resource requirements.</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">🖥️</span>
          <h3>Hardware Recommendations</h3>
          <p>Get tailored hardware suggestions based on your selected services.</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">🛒</span>
          <h3>Shopping List</h3>
          <p>Generate a ready-to-buy component list with purchase links.</p>
        </div>
      </section>
    </div>
  );
}

export default HomePage;
