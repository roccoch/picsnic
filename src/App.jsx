import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { BUCKET_NAME } from "./r2.js";
import './App.css';

const App = () => {
    const [selectedPhoto, setSelectedPhoto] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [user, setUser] = useState(null);
    const [loadingAuth, setLoadingAuth] = useState(true);
    
    const [galleryId, setGalleryId] = useState(null);
    const [enteredPin, setEnteredPin] = useState("");
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [pinError, setPinError] = useState("");

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(session.user);
                const savedGalleryId = localStorage.getItem('galleryId');
                if (savedGalleryId) {
                    setGalleryId(savedGalleryId);
                    setIsAuthorized(true);
                }
            }
            setLoadingAuth(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setUser(session?.user ?? null);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!isAuthorized || !galleryId) return;
        
        const fetchPhotos = async () => {
            const { data, error } = await supabase
                .from('photos')
                .select('*')
                .eq('gallery_id', galleryId)
                .order('created_at', { ascending: false });
                
            if (error) console.error("Error fetching photos:", error);
            else setPhotos(data);
        };
        fetchPhotos();
    }, [isAuthorized, galleryId]);

    const handlePinLogin = async () => {
        setPinError("");
        
        const { data: gallery, error } = await supabase
            .from('galleries')
            .select('id, pin, name')
            .eq('id', galleryId)
            .single();

        if (error || !gallery) {
            setPinError("Gallery not found.");
            return;
        }

        if (gallery.pin !== enteredPin) {
            setPinError("Incorrect PIN.");
            return;
        }

        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) {
            setPinError(`Error signing in: ${signInError.message}`);
            return;
        }

        localStorage.setItem('galleryId', galleryId);
        setIsAuthorized(true);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('galleryId');
        setIsAuthorized(false);
        setPhotos([]);
        setEnteredPin("");
        setGalleryId(null);
    };
    
    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);

        try {
            const timestamp = Date.now();
            const fileExt = file.name.split('.').pop();
            const fileName = `photos/${crypto.randomUUID()}.${fileExt}`;

            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

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

            const uploadResponse= await new Promise((resolve, reject)=>{
                const xhr = new XMLHttpRequest();

                xhr.open('PUT',signedUrl,true);
                xhr.setRequestHeader('Content-Type' , file.type);

                xhr.upload.onprogress = (event) =>{
                    if(event.lengthComputable) {
                        const percent = (event.loaded /event.total) * 100;
                        setUploadProgress(percent);
                    }
                };
                 xhr.onload=()=>{
                    if(xhr.status>=200&& xhr.status <300) resolve(xhr);
                    else reject(new Error(`upload to r2 failed ${xhr.status} - ${xhr.responseText}`));
                 };
                 xhr.onerror=()=> reject(new Error(`upload to r2 failed ${xhr.status} - ${xhr.responseText}`));
                 xhr.send(file);
            });
            const publicUrl = `https://pub-eb729244bff644f096fc52a1a6a4eba3.r2.dev/${fileName}`;
            await supabase.from('photos').insert([
                { 
                    title: file.name, 
                    url: publicUrl,
                    gallery_id: galleryId,
                    photographer_id: user.id 
                }
            ]);


        } catch (error) {
            console.error("Upload failed:", error);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    if (loadingAuth) {
        return <div style={{ textAlign: 'center', padding: '50px' }}>Loading...</div>;
    }

    if (!isAuthorized) {
        return (
            <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <h1>Picsnic</h1>
                    <p className="subtitle" style={{ marginBottom: '30px' }}>Client Gallery Login</p>
                    
                    <input 
                        type="text" 
                        placeholder="Gallery ID" 
                        value={galleryId || ""}
                        onChange={(e) => setGalleryId(e.target.value)}
                        style={{ display: 'block', margin: '10px auto', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', width: '300px' }}
                    />
                    <input 
                        type="password" 
                        placeholder="Enter 4-digit PIN" 
                        value={enteredPin}
                        onChange={(e) => setEnteredPin(e.target.value)}
                        style={{ display: 'block', margin: '10px auto', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', width: '300px' }}
                    />
                    <button 
                        onClick={handlePinLogin}
                        className="upload-btn"
                        style={{ fontSize: '16px', padding: '12px 32px', marginTop: '10px' }}
                    >
                        Enter Gallery
                    </button>
                    {pinError && <p style={{ color: 'red', marginTop: '10px' }}>{pinError}</p>}
                </div>
            </div>
        );
    }

    // Main app (logged in)
    return (
    <div className="app-container">
        <header className="app-header">
            <h1>Picsnic</h1>
            <p className="subtitle">Gallery: {galleryId}</p>
            
            <div style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                <input type="file" accept="image/*,video/*" onChange={handleUpload} id="upload-input" style={{ display: 'none' }} />
                <label htmlFor="upload-input" className="upload-btn">
                    {isUploading ? `Uploading... ${Math.round(uploadProgress)}%` : 'Upload Media'}
                </label>
                
                {/* FIXED: Changed classname to className */}
                {isUploading && (
                    <div className="progress-track" style={{ width: '200px', height: '10px', background: '#e0e0e0', borderRadius: '5px', overflow: 'hidden' }}>
                        <div className="progress-fill" style={{ width: `${uploadProgress}%`, height: '100%', background: '#007aff', transition: 'width 0.2s' }} />
                    </div>
                )}

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