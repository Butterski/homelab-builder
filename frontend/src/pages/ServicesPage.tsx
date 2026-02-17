import './ServicesPage.css';

function ServicesPage() {
  return (
    <div className="services-page">
      <div className="page-header">
        <h1>Service Catalog</h1>
        <p>Browse and select services for your homelab setup.</p>
      </div>
      <div className="services-placeholder">
        <p>Services will be loaded from the API once the backend is connected.</p>
      </div>
    </div>
  );
}

export default ServicesPage;
