import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { BUCKET_NAME } from "./r2.js";
import './App.css';

const App = () => {
    const [selectedPhoto, setSelectedPhoto] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [user, setUser] = useState(null);
    const [loadingAuth, setLoadingAuth] = useState(true);
    const [galleryId] = useState(crypto.randomUUID());

    // Check if user is logged in on mount
    useEffect(() => {
        // Get current session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            setLoadingAuth(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setUser(session?.user ?? null);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // Fetch photos from Supabase
    useEffect(() => {
        if (!user) return;
        
        const fetchPhotos = async () => {
            const { data, error } = await supabase
            .from('photos')
            .select('*')
            .order('created_at', { ascending: false });
                
            if (error) console.error("Error fetching photos:", error);
            else setPhotos(data);
        };
        fetchPhotos();
    }, [user, galleryId]);

    // Login function
    const handleLogin = async () => {
        try {
            // For Google OAuth:
            // await supabase.auth.signInWithOAuth({ provider: 'google' });
            
            // For now, using email/password. In a real app you'd have a form.
            // This is a simple prompt for demo purposes.
            const email = prompt("Enter your email:");
            const password = prompt("Enter your password:");
            
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            
            if (error) {
                // If user doesn't exist, sign them up
                if (error.message.includes("Invalid login credentials")) {
                    await supabase.auth.signUp({ email, password });
                } else {
                    alert(error.message);
                }
            }
        } catch (error) {
            console.error("Login error:", error);
        }
    };

    // Logout function
    const handleLogout = async () => {
        await supabase.auth.signOut();
        setPhotos([]);
    };

    
    // 2. Upload to Cloudflare R2
    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);

        try {
            const timestamp = Date.now();
            const fileName = `photos/${timestamp}_${file.name}`;

            // 1. Get the auth token OUTSIDE the fetch call
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            // 2. Ask our secure Edge Function for a presigned URL
            const response = await fetch("https://vckwrhhigxripsqziics.functions.supabase.co/generate-upload-url", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ fileName })
            });

            if (!response.ok) throw new Error("Failed to get upload URL");
            
            const { signedUrl } = await response.json();

            // ... rest of the upload code ...

            const uploadResponse = await fetch(signedUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type }
            });

            if (!uploadResponse.ok) throw new Error("Upload to R2 failed");

            const publicUrl = `https://pub-eb729244bff644f096fc52a1a6a4eba3.r2.dev/${fileName}`;

            await supabase.from('photos').insert([
                { 
                    title: file.name, 
                    url: publicUrl,
                    gallery_id: galleryId,
                    photographer_id: user.id // Now we have the user ID!
                }
            ]);

        } catch (error) {
            console.error("Upload failed:", error);
        } finally {
            setIsUploading(false);
        }
    };

    // Show loading spinner while checking auth
    if (loadingAuth) {
        return <div style={{ textAlign: 'center', padding: '50px' }}>Loading...</div>;
    }

    // Show login screen if not authenticated
    if (!user) {
        return (
            <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <h1>Picsnic</h1>
                    <p className="subtitle" style={{ marginBottom: '30px' }}>Client Photo Gallery</p>
                    <button 
                        onClick={handleLogin}
                        className="upload-btn"
                        style={{ fontSize: '16px', padding: '12px 32px' }}
                    >
                        Photographer Login
                    </button>
                </div>
            </div>
        );
    }

    // Main app (logged in)
    return (
    <div className="app-container">
        <header className="app-header">
            <h1>Picsnic</h1>
            <p className="subtitle">Welcome, {user.email}</p>
            
            <div style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <input type="file" accept="image/*,video/*" onChange={handleUpload} id="upload-input" style={{ display: 'none' }} />
                <label htmlFor="upload-input" className="upload-btn">
                    {isUploading ? 'Uploading...' : 'Upload Media'}
                </label>
                <button 
                    onClick={handleLogout}
                    className="close-btn"
                    style={{ background: '#fff', color: '#333', border: '1px solid #ccc' }}
                >
                    Logout
                </button>
            </div>
        </header>

        <main className="main-content">
            <div className="gallery-grid">
                {photos.map(photo => (
                    <div key={photo.id} className="photo-card" onClick={() => setSelectedPhoto(photo)}>
                        <img src={photo.url} alt={photo.title} loading="lazy" />
                    </div>
                ))}
            </div>
        </main>

        {selectedPhoto && (
            <div className="modal-overlay" onClick={() => setSelectedPhoto(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <img src={selectedPhoto.url} alt={selectedPhoto.title} />
                    <a href={selectedPhoto.url} download={selectedPhoto.title} className="download-btn">Download</a>
                    <button className="close-btn" onClick={() => setSelectedPhoto(null)}>Close</button>
                </div>
            </div>
        )}
    </div>
    );
};

export default App;