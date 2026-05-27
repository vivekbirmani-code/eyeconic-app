import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      alert('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    try {
      await login(email.trim(), password.trim());
      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      console.error('Login error:', error);
      const message = error?.response?.data?.message || error.message || 'Invalid credentials';
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#01b4ae] via-[#008f8a] to-[#01b4ae] flex flex-col items-center justify-center p-4">
      
      <div className="w-full max-w-md animate-fade-in-up">
        {/* Header Section */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center border-4 border-white/30 shadow-xl mb-6 overflow-hidden transform hover:scale-105 transition-transform duration-300">
             {/* Note: We will need to copy the logo to the web public folder */}
             <div className="text-[#01b4ae] font-bold text-2xl">EyE</div> 
          </div>
          <h1 className="text-4xl font-bold text-white tracking-widest mb-2 drop-shadow-md">EYECONIC</h1>
          <p className="text-white/90 text-sm tracking-wide font-medium">Your path to medical excellence</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl p-8 shadow-2xl">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-6">Welcome Back</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email Field */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                disabled={isLoading}
                className="w-full border-2 border-gray-200 rounded-xl p-4 text-base bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 transition-all outline-none"
                required
              />
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={isPasswordVisible ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={isLoading}
                  className="w-full border-2 border-gray-200 rounded-xl p-4 pr-12 text-base bg-gray-50 focus:bg-white focus:border-[#01b4ae] focus:ring-4 focus:ring-[#01b4ae]/20 transition-all outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {isPasswordVisible ? <EyeOff size={22} /> : <Eye size={22} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full bg-[#01b4ae] text-white rounded-xl p-4 font-bold text-lg tracking-wide shadow-lg shadow-[#01b4ae]/30 hover:bg-[#009b95] hover:shadow-[#01b4ae]/40 transform hover:-translate-y-0.5 transition-all active:scale-95 flex items-center justify-center mt-2 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>

            <p className="text-sm text-center text-gray-500 mt-4">
              Forgot password? Contact your administrator.
            </p>
          </form>

          {/* Footer */}
          <p className="text-xs text-center text-gray-500 mt-8 leading-relaxed">
            Contact your administrator if you need login credentials
          </p>
        </div>
      </div>
    </div>
  );
}
