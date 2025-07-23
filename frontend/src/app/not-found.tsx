import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="relative min-h-screen flex items-center justify-center">
      <div 
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          background: 'url(/noise.jpg)',
          opacity: 0.12
        }}
      />
      
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-8">Page not found</p>
        <Link 
          href="/" 
          className="inline-block px-6 py-3 bg-black text-white rounded hover:bg-gray-800 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
} 