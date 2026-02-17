import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Service } from '../types';
import { api } from '../services/api';
import './ServiceDetailPage.css';

function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadService();
  }, [id]);

  // Set document title for SEO
  useEffect(() => {
    if (service) {
      document.title = `${service.name} – Homelab Builder | Self-Hosted Setup Guide`;
      // Update meta description
      const desc = document.querySelector('meta[name="description"]');
      if (desc) {
        desc.setAttribute('content', `Set up ${service.name} on your homelab. Requirements: ${service.requirements?.recommended_ram_mb || '?'} MB RAM, ${service.requirements?.recommended_cpu_cores || '?'} CPU cores. Docker setup guide included.`);
      }
    }
    return () => { document.title = 'Homelab Builder'; };
  }, [service]);

  async function loadService() {
    try {
      setLoading(true);
      const res = await api.getService(id!);
      setService(res.data);
    } catch {
      setError('Service not found');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="service-detail-page">
        <div className="loading-state"><div className="spinner" /><p>Loading service...</p></div>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="service-detail-page">
        <div className="error-state">
          <p>⚠️ {error || 'Service not found'}</p>
          <button className="btn-primary" onClick={() => navigate('/services')}>Browse Services</button>
        </div>
      </div>
    );
  }

  const req = service.requirements;
  const categoryLabels: Record<string, string> = {
    media: 'Media & Entertainment',
    networking: 'Networking',
    monitoring: 'Monitoring & Observability',
    storage: 'Storage & Files',
    management: 'Management',
    home_automation: 'Home Automation',
    gaming: 'Gaming',
  };

  return (
    <div className="service-detail-page">
      {/* Breadcrumb for SEO */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <Link to="/services">Services</Link>
        <span className="sep">/</span>
        <span>{service.name}</span>
      </nav>

      <article className="service-article">
        <header className="service-header">
          <div className="service-icon-large">{service.icon || '📦'}</div>
          <div>
            <h1>{service.name}</h1>
            <span className="category-badge">{categoryLabels[service.category] || service.category}</span>
            {service.docker_support && <span className="docker-badge">🐳 Docker Ready</span>}
          </div>
        </header>

        <section className="service-description">
          <h2>About {service.name}</h2>
          <p>{service.description || `${service.name} is a popular self-hosted service for your homelab.`}</p>
          {service.official_website && (
            <a href={service.official_website} target="_blank" rel="noopener noreferrer" className="website-link">
              Official Website ↗
            </a>
          )}
        </section>

        {req && (
          <section className="service-requirements">
            <h2>Hardware Requirements</h2>
            <div className="req-grid">
              <div className="req-card">
                <h3>🧠 RAM</h3>
                <div className="req-values">
                  <div><span className="req-label">Minimum</span><span className="req-value">{req.min_ram_mb} MB</span></div>
                  <div><span className="req-label">Recommended</span><span className="req-value">{req.recommended_ram_mb} MB</span></div>
                </div>
              </div>
              <div className="req-card">
                <h3>🖥️ CPU</h3>
                <div className="req-values">
                  <div><span className="req-label">Minimum</span><span className="req-value">{req.min_cpu_cores} cores</span></div>
                  <div><span className="req-label">Recommended</span><span className="req-value">{req.recommended_cpu_cores} cores</span></div>
                </div>
              </div>
              <div className="req-card">
                <h3>💾 Storage</h3>
                <div className="req-values">
                  <div><span className="req-label">Minimum</span><span className="req-value">{req.min_storage_gb} GB</span></div>
                  <div><span className="req-label">Recommended</span><span className="req-value">{req.recommended_storage_gb} GB</span></div>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="service-cta">
          <h2>Ready to Deploy?</h2>
          <p>Add {service.name} to your selection and get personalized hardware recommendations.</p>
          <button className="btn-primary btn-large" onClick={() => navigate('/services')}>
            Select Services & Build Your Homelab →
          </button>
        </section>
      </article>

      {/* JSON-LD for SEO */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        'name': service.name,
        'description': service.description,
        'applicationCategory': 'Self-hosted',
        'operatingSystem': 'Linux',
        'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
      })}} />
    </div>
  );
}

export default ServiceDetailPage;
