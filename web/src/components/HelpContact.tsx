// Support contact shown in the Help card/modal. Update details here.
export const SUPPORT = {
  name: 'Nandana',
  email: 'nandana.v.manoj@gmail.com',
  mobile: '+91 81973 85353',
};

/** Just the contact rows — embedded in a card (Profile page) or a Modal (header "Help" link). */
export default function HelpContact() {
  return (
    <div className="help-contact">
      <div className="help-row">
        <span className="help-icon" aria-hidden>👤</span>
        <span className="help-val">{SUPPORT.name}</span>
      </div>
      <a className="help-row" href={`mailto:${SUPPORT.email}`}>
        <span className="help-icon" aria-hidden>✉️</span>
        <span className="help-val">{SUPPORT.email}</span>
      </a>
      <a className="help-row" href={`tel:${SUPPORT.mobile.replace(/\s+/g, '')}`}>
        <span className="help-icon" aria-hidden>📞</span>
        <span className="help-val">{SUPPORT.mobile}</span>
      </a>
    </div>
  );
}
