import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  return (
    <div className="auth-page">
      <h1>Forgot password</h1>
      <div className="card">
        <p>
          Password resets are handled by your <strong>Tower Representative</strong> or an{' '}
          <strong>Admin</strong> (v1 has no SMS reset). Please contact your tower rep — they can
          reset your password for you.
        </p>
        <p className="muted">
          (Self-service OTP reset will be added in a later version.)
        </p>
      </div>
      <p className="muted">
        <Link to="/login">Back to log in</Link>
      </p>
    </div>
  );
}
