import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, MapPin, Search, ArrowLeft, Video, X } from 'lucide-react';
import axios from 'axios';

// MapView Component with automatic geocoding
  const MapView = ({ shows, onShowSelect, onVenueSelect, setSelectedVenue }) => {
  const waitForMapbox = (maxAttempts = 20, interval = 500) => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const checkMapbox = () => {
      if (typeof window.mapboxgl !== 'undefined') {
        resolve();
        return;
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        reject(new Error('Mapbox GL JS failed to load after maximum attempts'));
        return;
      }
      
      setTimeout(checkMapbox, interval);
    };
    
    checkMapbox();
  });
};
  const mapContainerRef = React.useRef(null);
  const mapInitializedRef = React.useRef(false);
  const showsData = React.useMemo(() => shows, [shows]);
  const [map, setMap] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [geocodedShows, setGeocodedShows] = React.useState([]);
  const [showFilter, setShowFilter] = React.useState('upcoming'); // 'upcoming', 'past', 'all'

  // Helper function to determine if a show is past
  const isShowPast = useCallback((show) => {
    const [month, day, year] = show.show_date.split('/');
    const showDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return showDate < today;
  }, []);

  // Geocode addresses to get coordinates
  const geocodeAddress = async (address) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${process.env.REACT_APP_MAPBOX_TOKEN}&limit=1`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error for address:', address, error);
      return null;
    }
  };

  const formatDate = (dateString) => {
    const [month, day, year] = dateString.split('/');
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Filter shows based on selected filter
  const getFilteredShows = useCallback(() => {
    if (showFilter === 'upcoming') {
      return geocodedShows.filter(show => !isShowPast(show));
    } else if (showFilter === 'past') {
      return geocodedShows.filter(show => isShowPast(show));
    }
    return geocodedShows; // 'all'
  }, [geocodedShows, showFilter, isShowPast]);
  // Group shows by venue location (lat/lng)
   const groupShowsByVenue = useCallback((shows) => {
    const venueGroups = {};
    
    shows.forEach(show => {
      // Create a key based on venue name and approximate location
      const venueKey = `${show.venue}_${Math.round(show.lat * 1000)}_${Math.round(show.lng * 1000)}`;
      
      if (!venueGroups[venueKey]) {
        venueGroups[venueKey] = {
          venue: show.venue,
          address: show.address,
          lat: show.lat,
          lng: show.lng,
          shows: []
        };
      }
      
      venueGroups[venueKey].shows.push(show);
    });
    
    return Object.values(venueGroups);
  }, []);

  React.useEffect(() => {

    // Force reset on production if needed
    if (process.env.NODE_ENV === 'production' && mapInitializedRef.current && !map) {
      console.log('Resetting map initialization flag for production');
      mapInitializedRef.current = false;
    }

    // Only initialize once
    if (mapInitializedRef.current) return;
    const initializeMap = async () => {
      try {
        // Wait for Mapbox to be available
        await waitForMapbox();
        
        if (!process.env.REACT_APP_MAPBOX_TOKEN) {
          setError('Mapbox access token not found. Please add REACT_APP_MAPBOX_TOKEN to your environment variables.');
          setIsLoading(false);
          return;
        }

        // Geocode all show addresses
          const geocodingPromises = showsData.map(async (show) => {
          const coords = await geocodeAddress(show.address);
          return coords ? { ...show, ...coords, isPast: isShowPast(show) } : null;
        });

        const results = await Promise.all(geocodingPromises);
        const validShows = results.filter(show => show !== null);
        setGeocodedShows(validShows);

        if (mapContainerRef.current && validShows.length > 0) {
          window.mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;
          
          const mapInstance = new window.mapboxgl.Map({
            container: mapContainerRef.current,
            style: 'mapbox://styles/mapbox/streets-v11',
            center: [-98.5795, 39.8283], // Center of US
            zoom: 3
          });

          // Wait for the map to load before setting it
          mapInstance.on('load', () => {
            setMap(mapInstance);
          mapInitializedRef.current = true;
          });
        }
        
        setIsLoading(false);
      } catch (error) {
        setError(`Error initializing map: ${error.message}`);
        setIsLoading(false);
      }
    };
    initializeMap();
    
    return () => {
      // Don't cleanup the map here - let the separate cleanup effect handle it
    };
  }, [showsData, isShowPast, map]);
      React.useEffect(() => {
    return () => {
      if (map) {
        map.remove();
        setMap(null);
      }
    };
  }, [map]);
      React.useEffect(() => {
    if (!map || geocodedShows.length === 0) return;
    document.querySelectorAll('.mapboxgl-popup').forEach(p => p.remove());
    // Clear existing markers
    const existingMarkers = document.querySelectorAll('.mapboxgl-marker');
    existingMarkers.forEach(marker => marker.remove());

    const filteredShows = getFilteredShows();
    
    if (filteredShows.length === 0) return;

    // Group shows by venue
    const venueGroups = groupShowsByVenue(filteredShows);

    // Add markers for each venue group
    const bounds = new window.mapboxgl.LngLatBounds();
    
    venueGroups.forEach(venueGroup => {
      const { venue, shows, lat, lng } = venueGroup;
      const showCount = shows.length;
      
      // Determine if venue has upcoming, past, or mixed shows
      const upcomingShows = shows.filter(show => !show.isPast);
      const pastShows = shows.filter(show => show.isPast);
      
      let markerColor;
      if (showFilter === 'upcoming' || (upcomingShows.length > 0 && pastShows.length === 0)) {
        markerColor = '#2563EB'; // Blue for upcoming
      } else if (showFilter === 'past' || (pastShows.length > 0 && upcomingShows.length === 0)) {
        markerColor = '#6B7280'; // Gray for past
      } else {
        // Mixed shows (when showing all)
        markerColor = '#8B5CF6'; // Purple for mixed
      }

      // Create a single, simple marker element with inline badge
      const markerElement = document.createElement('div');
      markerElement.className = 'venue-marker';
      
      if (showCount > 1) {
        // Marker with count badge
        markerElement.innerHTML = `
          <div style="position: relative; display: inline-block;">
            <div style="
              width: 20px; 
              height: 20px; 
              background-color: ${markerColor}; 
              border: 2px solid white; 
              border-radius: 50%; 
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            "></div>
            <div style="
              position: absolute;
              top: -6px;
              right: -6px;
              background-color: ${markerColor};
              color: white;
              border-radius: 50%;
              width: 16px;
              height: 16px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 9px;
              font-weight: bold;
              border: 1px solid white;
              font-family: Arial, sans-serif;
            ">${showCount > 99 ? '99+' : showCount}</div>
          </div>
        `;
      } else {
        // Simple marker without badge
        markerElement.innerHTML = `
          <div style="
            width: 20px; 
            height: 20px; 
            background-color: ${markerColor}; 
            border: 2px solid white; 
            border-radius: 50%; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          "></div>
        `;
      }

      markerElement.style.cssText = 'cursor: pointer;';

      // Sort shows by date for popup
      const sortedShows = shows.sort((a, b) => {
        const dateA = new Date(a.show_date.split('/')[2], a.show_date.split('/')[0] - 1, a.show_date.split('/')[1]);
        const dateB = new Date(b.show_date.split('/')[2], b.show_date.split('/')[0] - 1, b.show_date.split('/')[1]);
        return dateA - dateB;
      });

      // Create enhanced popup content
      const createPopupContent = () => {
        const maxShowsToDisplay = 2; // Back to showing 2 shows max
        const showsToDisplay = sortedShows.slice(0, maxShowsToDisplay);
        const remainingCount = sortedShows.length - maxShowsToDisplay;

        let content = `
          <div class="p-3 min-w-[250px] max-w-[300px] max-h-[350px] overflow-y-auto">
            <h3 class="font-bold text-gray-900 mb-2">${venue}</h3>
        `;

        // Show count and type summary
        if (showCount > 1) {
          const upcomingCount = upcomingShows.length;
          const pastCount = pastShows.length;
          
          content += `<div class="text-xs mb-3 flex gap-1">`;
          if (upcomingCount > 0) {
            content += `<span class="bg-blue-100 text-blue-700 px-2 py-1 rounded">${upcomingCount} upcoming</span>`;
          }
          if (pastCount > 0) {
            content += `<span class="bg-gray-100 text-gray-700 px-2 py-1 rounded">${pastCount} past</span>`;
          }
          content += `</div>`;
        }

        // Display individual shows (clickable)
        showsToDisplay.forEach((show, index) => {
          const isPast = show.isPast;
          const showId = `${show.venue}_${show.show_date}_${show.group}`.replace(/[^a-zA-Z0-9]/g, '_');
          content += `
            <div 
              class="mb-2 pb-2 cursor-pointer hover:bg-gray-50 p-1 rounded ${index < showsToDisplay.length - 1 ? 'border-b border-gray-100' : ''}"
              onclick="window.showIndividualShow('${showId}')"
              style="transition: background-color 0.2s;"
            >
              <p class="text-blue-600 font-medium text-sm hover:text-blue-800">${show.group}</p>
              <p class="text-xs text-gray-600">${formatDate(show.show_date)}</p>
              <div class="text-xs px-1 py-0.5 rounded inline-block mt-1 ${
                isPast ? 'bg-gray-100 text-gray-700' : 'bg-blue-100 text-blue-700'
              }">
                ${isPast ? 'Past' : 'Upcoming'}
              </div>
              <p class="text-xs text-gray-500 mt-1">Click for details</p>
            </div>
          `;
        });

        // Add "view more" if there are remaining shows
        if (remainingCount > 0) {
          content += `
            <div class="text-xs text-gray-500 italic mb-2 p-1">
              + ${remainingCount} more show${remainingCount > 1 ? 's' : ''} at this venue
            </div>
          `;
        }

        // Add view all button
        content += `
            <button 
              onclick="window.showVenueDetails('${venue.replace(/'/g, "\\'")}')"
              class="w-full bg-blue-600 text-white text-xs px-2 py-1 rounded hover:bg-blue-700"
            >
              ${showCount > 1 ? 'View All Shows at This Venue' : 'View Venue Details'}
            </button>
          </div>
        `;

        return content;
      };

      const popup = new window.mapboxgl.Popup({ 
        offset: 25, 
        maxWidth: '320px',
        maxHeight: '400px',
        closeButton: true,
        closeOnClick: true,
        focusAfterOpen: false,
        className: 'venue-popup'
      })
        .setHTML(createPopupContent());

      new window.mapboxgl.Marker(markerElement)
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map);

      bounds.extend([lng, lat]);
    });

    // Fit map to show all markers
    if (venueGroups.length > 1) {
      map.fitBounds(bounds, { padding: 50 });
    } else if (venueGroups.length === 1) {
      map.setCenter([venueGroups[0].lng, venueGroups[0].lat]);
      map.setZoom(12);
    }

    // Global functions to handle clicks
    window.showVenueDetails = (venueName) => {
      // Find the venue group from the original geocoded shows (unfiltered)
      const allVenueGroups = groupShowsByVenue(geocodedShows);
      const venueGroup = allVenueGroups.find(vg => vg.venue === venueName);
      if (venueGroup && venueGroup.shows.length > 0) {
        // Open venue modal with ALL shows from this venue and current map filter
        setSelectedVenue({
          name: venueGroup.venue,
          shows: venueGroup.shows,
          defaultFilter: showFilter // Pass current map filter as default
        });
      }
    };

    // Function to handle individual show clicks from popups
    window.showIndividualShow = (showId) => {
      // Find the show by reconstructing the ID
      const show = venueGroups.flatMap(vg => vg.shows).find(s => {
        const reconstructedId = `${s.venue}_${s.show_date}_${s.group}`.replace(/[^a-zA-Z0-9]/g, '_');
        return reconstructedId === showId;
      });
      
      if (show) {
        onShowSelect(show);
      }
    };

  }, [map, geocodedShows, showFilter, onShowSelect, getFilteredShows, groupShowsByVenue, setSelectedVenue]);

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <MapPin size={48} className="mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Map Setup Required</h3>
        <p className="text-gray-600 mb-4">{error}</p>
        <p className="text-sm text-gray-500">
          Get a free Mapbox token at mapbox.com and add it as REACT_APP_MAPBOX_TOKEN
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading map and geocoding addresses...</p>
      </div>
    );
  }

  const filteredShows = getFilteredShows();
  const upcomingCount = geocodedShows.filter(show => !show.isPast).length;
  const pastCount = geocodedShows.filter(show => show.isPast).length;

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {/* Filter Controls */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex space-x-2">
            <button
              onClick={() => setShowFilter('all')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                showFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All Shows ({geocodedShows.length})
            </button>
            <button
              onClick={() => setShowFilter('upcoming')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                showFilter === 'upcoming'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Upcoming ({upcomingCount})
            </button>
            <button
              onClick={() => {
                setShowFilter('past');
                // Reset map view to show past markers
                if (map && geocodedShows.length > 0) {
                  const pastShows = geocodedShows.filter(show => show.isPast);
                  if (pastShows.length > 0) {
                    const bounds = new window.mapboxgl.LngLatBounds();
                    pastShows.forEach(show => {
                      bounds.extend([show.lng, show.lat]);
                    });
                    map.fitBounds(bounds, { padding: 50 });
                  }
                }
              }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                showFilter === 'past'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Past ({pastCount})
            </button>
          </div>
          
          {/* Legend */}
          <div className="flex items-center space-x-4 text-xs text-gray-600">
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-blue-600 rounded-full border border-white"></div>
              <span>Upcoming</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-gray-500 rounded-full border border-white"></div>
              <span>Past</span>
            </div>
          </div>
        </div>
        
        <p className="text-sm text-gray-600">
          Showing {filteredShows.length} of {shows.length} venues on map
          {geocodedShows.length < shows.length && (
            <span className="text-amber-600 ml-2">
              ({shows.length - geocodedShows.length} addresses could not be geocoded)
            </span>
          )}
        </p>
      </div>
      
      <div 
        ref={mapContainerRef} 
        className="w-full h-[800px]"
        style={{ minHeight: '800px' }}
      />
    </div>
  );
};

const ShowsTracker = () => {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('upcoming');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedShow, setSelectedShow] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [userTimezone, setUserTimezone] = useState('');
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [pastPage, setPastPage] = useState(1);
  const SHOWS_PER_PAGE = 30;
  const parseDate = (dateString) => {
  const [month, day, year] = dateString.split('/');
 
  return new Date(year, month - 1, day);
};

const parseShowTimes = (timeString) => {
  if (!timeString) return [];
  return timeString.split(',').map(time => time.trim()).filter(time => time.length > 0);
};

  useEffect(() => {
    // Get user's timezone
    setUserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    loadShows();
  }, []);

  // Reset pagination when search term changes
  useEffect(() => {
    setUpcomingPage(1);
    setPastPage(1);
  }, [searchTerm]);

  const loadShows = async () => {
    setLoading(true);
    try {

console.log('Sheet ID:', process.env.REACT_APP_GOOGLE_SHEETS_ID);
console.log('API Key exists:', !!process.env.REACT_APP_GOOGLE_API_KEY);

      const response = await axios.get(
  `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REACT_APP_GOOGLE_SHEETS_ID}/values/Sheet1!A2:L?key=${process.env.REACT_APP_GOOGLE_API_KEY}`
  
);

      const rows = response.data.values || [];
      const formattedShows = rows.map(row => ({
  launch_date: row[0] || '',           // A: Launch_Date
  show_date: row[1] || '',             // B: Show_Date  
  show_time: row[2] || '',             // C: Show_Time
  venue: row[3] || '',                 // D: Venue
  address: row[4] || '',               // E: Address
  group: row[5] || '',                 // F: Group
  ticket_url: row[6] || '',            // G: Ticket_URL
  show_type: row[7] || '',             // H: Show_Type
  show_description: row[8] || '',      // I: Show_Description
  lineup: row[9] || '',                // J: Lineup
  show_image: row[10] || '',           // K: Show_Image
  livestream_ticket_url: row[11] || '', // L: Livestream_Ticket_URL
  capacity: ''                         // Not in your sheet, keeping as empty for compatibility
}));

      console.log('Loaded shows:', formattedShows);
      setShows(formattedShows);
      setLoading(false);
    } catch (error) {
      console.error('Error loading shows:', error);
      console.error('Error details:', error.response?.data);
      
      // Fallback to mock data if API fails
      const mockData = [
  {
    launch_date: '',
    show_date: '09/15/2025',
    show_time: '8:00pm',
    venue: 'Test Venue (API Error)',
    address: 'New York, NY', // Changed from separate city/state
    group: 'Test Group',
    ticket_url: '',
    capacity: '',
    show_image: '',
    show_type: 'Concert',
    show_description: 'This is mock data - check console for API errors',
    lineup: '',
    livestream_ticket_url: ''
  }
];
      
      setShows(mockData);
      setLoading(false);
    }
  };
      

const parseAddress = (addressString) => {
  if (!addressString) return { fullAddress: '', city: '', state: '', country: 'USA' };
  
  // Clean up and split by commas
  const parts = addressString.trim().split(',').map(p => p.trim()).filter(p => p.length > 0);
  
  if (parts.length === 0) {
    return { fullAddress: addressString, city: addressString, state: '', country: 'USA' };
  }
  
  // Look for zip/postal code patterns in any part
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    // Check if this part is just a US ZIP code (5 digits, optionally with dash and 4 more)
    const standAloneZipMatch = part.match(/^(\d{5}(-\d{4})?)$/);
    if (standAloneZipMatch && i >= 2) {
      // State should be in the previous part
      const statePart = parts[i - 1];
      if (statePart.match(/^[A-Z]{2}$/)) {
        const state = statePart;
        const zip = standAloneZipMatch[1];
        
        // City should be in the part before the state
        const cityPart = parts[i - 2];
        const city = extractCityFromPart(cityPart);
        
        return {
          fullAddress: addressString,
          city: city,
          state: state,
          zip: zip,
          country: 'USA'
        };
      }
    }
    
    // US ZIP code pattern within a part: 5 digits, optionally followed by dash and 4 more digits
    const usZipMatch = part.match(/\b(\d{5}(-\d{4})?)\b/);
    if (usZipMatch) {
      // Extract state (should be 2 letters before the zip in the same part)
      const beforeZip = part.replace(usZipMatch[0], '').trim();
      const stateMatch = beforeZip.match(/\b([A-Z]{2})\b$/);
      
      if (stateMatch && i > 0) {
        const state = stateMatch[1];
        const zip = usZipMatch[1];
        
        // Get city from the previous part (before state/zip part)
        const cityPart = parts[i - 1];
        const city = extractCityFromPart(cityPart);
        
        return {
          fullAddress: addressString,
          city: city,
          state: state,
          zip: zip,
          country: 'USA'
        };
      }
    }
    
    // UK postal code pattern: Letters and numbers like "WC2H 7BX" or "M1 1AA"
    const ukPostalMatch = part.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
    if (ukPostalMatch) {
      // Get the city from this same part, before the postal code
      const beforePostal = part.replace(ukPostalMatch[0], '').trim();
      const city = beforePostal || (i > 0 ? extractCityFromPart(parts[i - 1]) : '');
      
      return {
        fullAddress: addressString,
        city: city,
        state: '',
        country: 'UK'
      };
    }
  }
  
  // Fallback: try the old method for addresses without clear zip patterns
  const lastPart = parts[parts.length - 1];
  
  // Check if last part is just US state (no zip found)
  if (lastPart.match(/^[A-Z]{2}$/) && parts.length >= 2) {
    const state = lastPart;
    const cityPart = parts[parts.length - 2];
    const city = extractCityFromPart(cityPart);
    
    return {
      fullAddress: addressString,
      city: city,
      state: state,
      zip: '',
      country: 'USA'
    };
  }
  
  // Check for other countries
  if (lastPart.match(/^[A-Z]{2,3}$/) || (lastPart.length > 3 && /^[A-Za-z\s]+$/.test(lastPart))) {
    const country = lastPart;
    
    if (parts.length >= 2) {
      const cityPart = parts[parts.length - 2];
      const city = extractCityFromPart(cityPart);
      
      return {
        fullAddress: addressString,
        city: city,
        state: '',
        country: country
      };
    }
  }
  
  // Final fallback
  return {
    fullAddress: addressString,
    city: addressString,
    state: '',
    country: 'USA'
  };
};

// Helper function to extract city from a part that might contain street address
const extractCityFromPart = (part) => {
  if (!part) return '';
  
  const words = part.split(/\s+/);
  
  // Remove obvious street address components from the beginning
  let cityWords = [];
  let foundCity = false;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();
    
    // Skip leading numbers
    if (i === 0 && /^\d+$/.test(word)) {
      continue;
    }
    
    // Skip directionals and street types, but only at the beginning or if we haven't found city yet
    if (!foundCity && /^(n|s|e|w|north|south|east|west|street|st|avenue|ave|road|rd|blvd|boulevard|drive|dr|lane|ln|way|place|pl|court|ct|circle|cir)$/i.test(word)) {
      continue;
    }
    
    // Once we have a non-street word, consider it part of the city
    foundCity = true;
    cityWords.push(words[i]);
  }
  
  // If we found city words, use them; otherwise use the original part
  return cityWords.length > 0 ? cityWords.join(' ') : part;
};

  const isShowVisible = (show) => {
    if (!show.launch_date) return true;
    const launchDate = parseDate(show.launch_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return launchDate <= today;
  };

  const isShowPast = (show) => {
    const showDate = parseDate(show.show_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return showDate < today;
  };

  const visibleShows = shows.filter(isShowVisible);
  
  const upcomingShows = visibleShows
    .filter(show => !isShowPast(show))
    .sort((a, b) => parseDate(a.show_date) - parseDate(b.show_date));
  
  const pastShows = visibleShows
    .filter(isShowPast)
    .sort((a, b) => parseDate(b.show_date) - parseDate(a.show_date));

  const filteredUpcomingShows = upcomingShows.filter(show => {
    const addressInfo = parseAddress(show.address);
    return (
      show.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
      show.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      addressInfo.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
      addressInfo.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
      show.group.toLowerCase().includes(searchTerm.toLowerCase()) ||
      show.lineup.toLowerCase().includes(searchTerm.toLowerCase()) ||
      show.show_type.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Helper function to check if search term exists in other section
  const searchExistsInUpcoming = (searchTerm) => {
    if (!searchTerm) return false;
    return upcomingShows.some(show => {
      const addressInfo = parseAddress(show.address);
      return (
        show.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
        addressInfo.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        addressInfo.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.group.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.lineup.toLowerCase().includes(searchTerm.toLowerCase()) ||
    	show.show_type.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  };

  const searchExistsInPast = (searchTerm) => {
    if (!searchTerm) return false;
    return pastShows.some(show => {
      const addressInfo = parseAddress(show.address);
      return (
        show.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
        addressInfo.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        addressInfo.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.group.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.lineup.toLowerCase().includes(searchTerm.toLowerCase()) ||
        show.show_type.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  };

  const filteredPastShows = pastShows.filter(show => {
  const addressInfo = parseAddress(show.address);
  return (
    show.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
    show.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
    addressInfo.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    addressInfo.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
    show.group.toLowerCase().includes(searchTerm.toLowerCase()) ||
    show.lineup.toLowerCase().includes(searchTerm.toLowerCase()) ||
       show.show_type.toLowerCase().includes(searchTerm.toLowerCase())
  );
});

  const formatDate = (dateString) => {
    const date = parseDate(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const convertToUserTimezone = (showTime, address) => {
    // TODO: Implement actual timezone conversion
    // This is a placeholder that simulates timezone conversion
     if (userTimezone === 'America/New_York') return null; // Same timezone
     if (userTimezone === 'America/Los_Angeles') return '4:00pm PST in your time zone';
     if (userTimezone === 'Europe/London') return '1:00am GMT, Saturday the 16th in your time zone';
     return null;
};


  const getPaginatedShows = (showsList, currentPage) => {
    const startIndex = (currentPage - 1) * SHOWS_PER_PAGE;
    const endIndex = startIndex + SHOWS_PER_PAGE;
    return showsList.slice(startIndex, endIndex);
  };

  const getTotalPages = (showsList) => {
    return Math.ceil(showsList.length / SHOWS_PER_PAGE);
  };

  const parseLineup = (lineupString) => {
    if (!lineupString) return [];
    
    return lineupString.split('::').map(person => {
      const trimmed = person.trim();
      if (!trimmed) return null;
      
      let name = '';
      let instrument = '';
      let instagramLink = null;
      let websiteLink = null;
      
      // Extract instrument (anything in parentheses)
      const instrumentMatch = trimmed.match(/\(([^)]+)\)/);
      if (instrumentMatch) {
        instrument = instrumentMatch[1].trim();
      }
      
      // Extract Instagram handle
      const instagramMatch = trimmed.match(/@(\w+)/);
      if (instagramMatch) {
        instagramLink = `https://www.instagram.com/${instagramMatch[1]}`;
      }
      
      // Extract website - flexible patterns
      const websiteMatch = trimmed.match(/(https?:\/\/\S+|www\.\S+|\S+\.(com|net|org|edu|gov|io|co|me|info|biz|tv|fm|ly|gg|xyz|dev|app|blog|music|band|studio|art)\b\S*)/i);
      if (websiteMatch) {
        let website = websiteMatch[1];
        // Add https:// if it doesn't have a protocol
        if (!website.match(/^https?:\/\//)) {
          website = 'https://' + website;
        }
        websiteLink = website;
      }
      
      // Extract name (everything else, cleaned up)
      name = trimmed
        .replace(/\([^)]+\)/g, '') // Remove instrument
        .replace(/@\w+/g, '') // Remove Instagram handles
        .replace(/https?:\/\/\S+|www\.\S+|\S+\.(com|net|org|edu|gov|io|co|me|info|biz|tv|fm|ly|gg|xyz|dev|app|blog|music|band|studio|art)\b\S*/gi, '') // Remove websites
        .trim();
      
      return {
        name,
        instrument,
        instagramLink,
        websiteLink
      };
    }).filter(person => person !== null && person.name !== '');
  };
  const ShowModal = ({ show, onClose, onBackToVenue, showBackToVenue }) => {
  const lineup = parseLineup(show.lineup);
  const showTimes = parseShowTimes(show.show_time);
  
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div 
        className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          {show.show_image && (
            <div className="w-full h-64 bg-gray-200 rounded-t-lg overflow-hidden">
              <img 
                src={show.show_image} 
                alt={`${show.venue} show`}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          
          <button
            onClick={onClose}
            className="absolute top-4 right-4 bg-white bg-opacity-90 rounded-full p-2 hover:bg-opacity-100 transition-all"
          >
            <X size={20} />
          </button>
          {showBackToVenue && (
            <button
              onClick={() => onBackToVenue()}
              className="absolute top-4 right-16 bg-white bg-opacity-90 rounded-full p-2 hover:bg-opacity-100 transition-all flex items-center gap-1 px-3"
            >
              <ArrowLeft size={16} />
              <span className="text-sm">Back to Venue</span>
            </button>
          )}
        </div>
        
        <div className="p-6">
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{show.venue}</h2>
            <p className="text-lg text-gray-600 mb-1">{show.group}</p>
            <p className="text-gray-600">
              {formatDate(show.show_date)} • {showTimes.length > 1 ? showTimes.join(', ') : show.show_time}
            </p>
            <p className="text-gray-600">{show.address}</p>
            {show.capacity && (
              <p className="text-sm text-gray-500 mt-1">Capacity: {show.capacity}</p>
            )}
          </div>

          {/* Display showtimes - consistent format for single and multiple */}
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">
              {showTimes.length > 1 ? 'Showtimes' : 'Showtime'}
            </h3>
            <div className={showTimes.length > 1 ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3 max-w-xs"}>
              {showTimes.length > 1 ? (
                showTimes.map((time, index) => (
                  <div 
                    key={index} 
                    className={`bg-gray-50 p-3 rounded-lg text-center ${
                      show.ticket_url && show.ticket_url.trim() !== '' 
                        ? 'cursor-pointer hover:bg-gray-100 transition-colors' 
                        : ''
                    }`}
                    onClick={() => {
                      if (show.ticket_url && show.ticket_url.trim() !== '') {
                        window.open(show.ticket_url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    <p className="font-medium">{time}</p>
                    {show.livestream_ticket_url && (
		
                      <p className="text-sm text-gray-600 mt-1">
                        Stream: {convertToUserTimezone(time, show.address) || time}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div 
                  className={`bg-gray-50 p-3 rounded-lg text-center ${
                    show.ticket_url && show.ticket_url.trim() !== '' 
                      ? 'cursor-pointer hover:bg-gray-100 transition-colors' 
                      : ''
                  }`}
                  onClick={() => {
                    if (show.ticket_url && show.ticket_url.trim() !== '') {
                      window.open(show.ticket_url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                >
                  <p className="font-medium">{show.show_time}</p>
                  {show.livestream_ticket_url && (
                    <p className="text-sm text-gray-600 mt-1">
                      Stream: {convertToUserTimezone(show.show_time, show.address) || show.show_time}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {show.show_description && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">About the Show</h3>
              <p className="text-gray-700">{show.show_description}</p>
            </div>
          )}

          {lineup.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Lineup</h3>
              <div className="space-y-2">
                {lineup.map((member, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    {member.instagramLink ? (
                      <a 
                        href={member.instagramLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {member.name}
                      </a>
                    ) : (
                      <span className="font-medium">{member.name}</span>
                    )}
                    {member.instrument && (
                      <span className="text-gray-600">({member.instrument})</span>
                    )}
                    {member.websiteLink && (
                      <>
                        <span className="text-gray-400">-</span>
                        <a 
                          href={member.websiteLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          website
                        </a>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            {show.ticket_url && show.ticket_url.trim() !== '' && (
              <a href={show.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-blue-600 text-white text-center py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium inline-block"
              >
                {showTimes.length > 1 ? 'Get Tickets (All Shows)' : 'Get Tickets'}
              </a>
            )}
            
            {show.livestream_ticket_url && show.livestream_ticket_url.trim() !== '' && (
              <a href={show.livestream_ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-red-600 text-white text-center py-3 px-4 rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <Video size={20} />
                {showTimes.length > 1 ? 'Livestream (All Shows)' : 'Livestream'}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
  const VenueModal = ({ venue, shows, onClose, onShowSelect, defaultFilter = 'all' }) => {
  const [venueShowFilter, setVenueShowFilter] = useState(defaultFilter);
  
  // Filter shows based on venue modal filter
  const getVenueFilteredShows = () => {
    if (venueShowFilter === 'upcoming') {
      return shows.filter(show => !isShowPast(show));
    } else if (venueShowFilter === 'past') {
      return shows.filter(show => isShowPast(show));
    }
    return shows; // 'all'
  };

  const filteredShows = getVenueFilteredShows();
  const upcomingCount = shows.filter(show => !isShowPast(show)).length;
  const pastCount = shows.filter(show => isShowPast(show)).length;

  // Sort shows by date (upcoming shows first, then past shows in reverse chronological order)
  const sortedShows = filteredShows.sort((a, b) => {
    const dateA = parseDate(a.show_date);
    const dateB = parseDate(b.show_date);
    const isPastA = isShowPast(a);
    const isPastB = isShowPast(b);
    
    if (isPastA && !isPastB) return 1; // Past shows come after upcoming
    if (!isPastA && isPastB) return -1; // Upcoming shows come first
    
    if (isPastA && isPastB) {
      return dateB - dateA; // Past shows in reverse chronological order (newest first)
    }
    
    return dateA - dateB; // Upcoming shows in chronological order
  });
  
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{venue}</h2>
              <p className="text-gray-600">{shows.length} show{shows.length !== 1 ? 's' : ''} at this venue</p>
            </div>
            <button
              onClick={onClose}
              className="bg-gray-100 hover:bg-gray-200 rounded-full p-2 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Filter Controls */}
          <div className="mb-6">
            <div className="flex space-x-2">
              <button
                onClick={() => setVenueShowFilter('all')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  venueShowFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All Shows ({shows.length})
              </button>
              <button
                onClick={() => setVenueShowFilter('upcoming')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  venueShowFilter === 'upcoming'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Upcoming ({upcomingCount})
              </button>
              <button
                onClick={() => setVenueShowFilter('past')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  venueShowFilter === 'past'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Past ({pastCount})
              </button>
            </div>
          </div>

          {/* Shows List */}
          <div className="space-y-3">
            {sortedShows.map((show, index) => {
              const isPast = isShowPast(show);
              const showTimes = parseShowTimes(show.show_time);
              
              return (
                <div 
                  key={index}
                  className={`p-4 rounded-lg cursor-pointer transition-colors border ${
                    isPast 
                      ? 'bg-gray-50 hover:bg-gray-100' 
                      : 'bg-green-50 border-2 border-green-300 hover:bg-green-100'
                  }`}
                  onClick={() => {
                    onShowSelect({ ...show, fromVenue: { name: venue, shows: shows, defaultFilter: venueShowFilter } });
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-grow">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">{show.group}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          isPast 
                            ? 'bg-gray-200 text-gray-700' 
                            : 'bg-green-100 text-green-800 font-semibold'
                        }`}>
                          {isPast ? 'Past' : 'Upcoming'}
                        </span>
                        {show.livestream_ticket_url && (
                          <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                            <Video size={10} />
                            LIVESTREAM
                          </span>
                        )}
                      </div>
                      
                      <p className="text-gray-600 mb-1">
                        {formatDate(show.show_date)} • {showTimes.length > 1 ? `${showTimes.length} shows` : show.show_time}
                      </p>
                      
                      {show.show_description && (
                        <p className="text-sm text-gray-600 mb-2">{show.show_description}</p>
                      )}
                      
                      <p className="text-sm text-blue-600">Click for details</p>
                    </div>
                    
                    <div className="flex items-center space-x-2 ml-4">
                      {!isPast && show.ticket_url && show.ticket_url.trim() !== '' && (
                        <a href={show.ticket_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-blue-600 text-white text-xs px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Tickets
                        </a>
                      )}
                      
                      {!isPast && show.livestream_ticket_url && show.livestream_ticket_url.trim() !== '' && (
                        <a href={show.livestream_ticket_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-red-600 text-white text-xs px-3 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Video size={12} />
                          Stream
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {filteredShows.length === 0 && (
            <div className="text-center py-8">
              <Calendar size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No shows found</h3>
              <p className="text-gray-600">
                {venueShowFilter === 'upcoming' && 'No upcoming shows at this venue'}
                {venueShowFilter === 'past' && 'No past shows at this venue'}
                {venueShowFilter === 'all' && 'No shows found'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
  const ShowCard = ({ show }) => {
  const showTimes = parseShowTimes(show.show_time);
  const hasLivestream = show.livestream_ticket_url;
  
  return (
    <div 
      className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 hover:shadow-md hover:bg-green-50 transition-all cursor-pointer"
      onClick={() => setSelectedShow(show)}
    >
      <div className="flex items-center justify-between">
        {/* Left side - Date and Time */}
        <div className="flex-shrink-0 text-center min-w-[100px] mr-6">
          <div className="text-lg font-bold text-gray-900">
            {parseDate(show.show_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
          <div className="text-sm text-gray-600 font-medium">
            {showTimes.length > 1 ? `${showTimes.length} shows` : show.show_time}
          </div>
        </div>

        {/* Middle - Show Info */}
        <div className="flex-grow">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-1 hover:text-blue-600">
                {(() => {
                  const addressInfo = parseAddress(show.address);
                  if (addressInfo.city && addressInfo.state) {
                    return `${addressInfo.city}, ${addressInfo.state} at ${show.venue}`;
                  } else if (addressInfo.city && addressInfo.country && addressInfo.country !== 'USA') {
                    return `${addressInfo.city}, ${addressInfo.country} at ${show.venue}`;
                  } else if (addressInfo.city) {
                    return `${addressInfo.city} at ${show.venue}`;
                  } else {
                    return show.venue;
                  }
                })()}
              </h3>
              <p className="text-lg text-blue-600 font-medium mb-1">{show.group}</p>
            </div>
            
            {/* Right side - Badges */}
            <div className="hidden sm:flex items-center space-x-2 flex-shrink-0">
                {hasLivestream && (
                  <div className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full flex items-center gap-1 justify-center text-center">
                    <Video size={12} />
                    LIVESTREAM
                  </div>
                )}
                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center justify-center text-center whitespace-nowrap">
                  {show.show_type}
                </span>
              </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center text-gray-600 text-sm">
              <span className="text-blue-600 hover:text-blue-700">Click for details</span>
            </div>
            
            {/* Action Buttons */}
	    <p className="text-sm text-gray-500 mt-4 text-center">
  {show.fromVenue ? 'Click "Back to Venue" to see other shows' : ''}
</p>
            <div className="flex items-center space-x-3">
              {/* Get Tickets Button */}
              {show.ticket_url && show.ticket_url.trim() !== '' && (
                <a
                  href={show.ticket_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  Get Tickets
                </a>
              )}

              {/* Livestream Button */}
              {hasLivestream && show.livestream_ticket_url.trim() !== '' && (
                <a
                  href={show.livestream_ticket_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-red-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Video size={14} />
                  Stream
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading shows...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => window.location.href = 'https://classicaltrombone.com'}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={20} />
              <span className="hidden sm:inline">Back to Main Site</span>
              <span className="sm:hidden">Back</span>
            </button>
            
            <nav className="flex space-x-2 sm:space-x-8">
              <button
                onClick={() => setCurrentView('upcoming')}
                className={`px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  currentView === 'upcoming'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="hidden sm:inline">Upcoming Shows ({upcomingShows.length})</span>
                <span className="sm:hidden">Upcoming ({upcomingShows.length})</span>
              </button>
              
              <button
                onClick={() => setCurrentView('past')}
                className={`px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  currentView === 'past'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="hidden sm:inline">Past Shows ({pastShows.length})</span>
                <span className="sm:hidden">Past ({pastShows.length})</span>
              </button>
              
                            {/* Hide map on mobile - only show on sm and larger screens */}
              <button
                onClick={() => setCurrentView('map')}
                className={`hidden sm:flex px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  currentView === 'map'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Map View
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upcoming Shows */}
        {currentView === 'upcoming' && (
          <div>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Upcoming Shows</h1>
              <p className="text-gray-600"></p>
            </div>

            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search by venue, city, state, group, or lineup..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {filteredUpcomingShows.length === 0 ? (
              <div className="text-center py-12">
                {searchTerm ? (
                  <>
                    <Search size={48} className="mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No shows found</h3>
                    <p className="text-gray-600 mb-4">No upcoming shows match "{searchTerm}"</p>
                    {searchExistsInPast(searchTerm) && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto">
                        <p className="text-blue-800 mb-3">Found matches in past shows!</p>
                        <button
                          onClick={() => setCurrentView('past')}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          View Past Shows
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Calendar size={48} className="mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No upcoming shows</h3>
                    <p className="text-gray-600">Check back soon for new dates!</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-0">
                  {getPaginatedShows(filteredUpcomingShows, upcomingPage).map((show, index) => (
                    <ShowCard key={index} show={show} />
                  ))}
                </div>
                
                {/* Pagination Controls */}
                {getTotalPages(filteredUpcomingShows) > 1 && (
                  <div className="flex items-center justify-between mt-8 px-4">
                    <div className="text-sm text-gray-600">
                      Showing {((upcomingPage - 1) * SHOWS_PER_PAGE) + 1} to {Math.min(upcomingPage * SHOWS_PER_PAGE, filteredUpcomingShows.length)} of {filteredUpcomingShows.length} shows
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setUpcomingPage(prev => Math.max(prev - 1, 1))}
                        disabled={upcomingPage === 1}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Previous
                      </button>
                      
                      <span className="px-3 py-2 text-sm">
                        Page {upcomingPage} of {getTotalPages(filteredUpcomingShows)}
                      </span>
                      
                      <button
                        onClick={() => setUpcomingPage(prev => Math.min(prev + 1, getTotalPages(filteredUpcomingShows)))}
                        disabled={upcomingPage === getTotalPages(filteredUpcomingShows)}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

            {/* Show suggestion for past shows if search has matches there */}
            {searchTerm && filteredUpcomingShows.length > 0 && searchExistsInPast(searchTerm) && (
              <div className="mt-8 text-center">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto">
                  <p className="text-blue-800 mb-3">Also found matches in past shows!</p>
                  <button
                    onClick={() => setCurrentView('past')}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    View Past Shows
                  </button>
                </div>
              </div>
            )}

              </>
            )}
          </div>
        )}

        {/* Past Shows */}
        {currentView === 'past' && (
          <div>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Past Shows</h1>
              <p className="text-gray-600">Archive of previous performances</p>
            </div>

            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search by venue, city, state, group, or lineup..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {filteredPastShows.length === 0 ? (
              <div className="text-center py-12">
                {searchTerm ? (
                  <>
                    <Search size={48} className="mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No past shows found</h3>
                    <p className="text-gray-600 mb-4">No past shows match "{searchTerm}"</p>
                    {searchExistsInUpcoming(searchTerm) && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                        <p className="text-green-800 mb-3">Found matches in upcoming shows!</p>
                        <button
                          onClick={() => setCurrentView('upcoming')}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                        >
                          View Upcoming Shows
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Search size={48} className="mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No shows found</h3>
                    <p className="text-gray-600">Try adjusting your search terms</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-0">
                  {getPaginatedShows(filteredPastShows, pastPage).map((show, index) => (
                    <ShowCard key={index} show={show} />
                  ))}
                </div>
                
                {/* Pagination Controls */}
                {getTotalPages(filteredPastShows) > 1 && (
                  <div className="flex items-center justify-between mt-8 px-4">
                    <div className="text-sm text-gray-600">
                      Showing {((pastPage - 1) * SHOWS_PER_PAGE) + 1} to {Math.min(pastPage * SHOWS_PER_PAGE, filteredPastShows.length)} of {filteredPastShows.length} shows
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setPastPage(prev => Math.max(prev - 1, 1))}
                        disabled={pastPage === 1}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Previous
                      </button>
                      
                      <span className="px-3 py-2 text-sm">
                        Page {pastPage} of {getTotalPages(filteredPastShows)}
                      </span>
                      
                      <button
                        onClick={() => setPastPage(prev => Math.min(prev + 1, getTotalPages(filteredPastShows)))}
                        disabled={pastPage === getTotalPages(filteredPastShows)}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

            {/* Show suggestion for upcoming shows if search has matches there */}
            {searchTerm && filteredPastShows.length > 0 && searchExistsInUpcoming(searchTerm) && (
              <div className="mt-8 text-center">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                  <p className="text-green-800 mb-3">Also found matches in upcoming shows!</p>
                  <button
                    onClick={() => setCurrentView('upcoming')}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    View Upcoming Shows
                  </button>
                </div>
              </div>
            )}

              </>
            )}
          </div>
        )}

        {/* Map View */}
        {currentView === 'map' && (
          <div>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Show Locations</h1>
              <p className="text-gray-600">Interactive map of all show venues</p>
            </div>

            <MapView shows={visibleShows} 
              onShowSelect={setSelectedShow} 
              onVenueSelect={() => {}} 
              setSelectedVenue={setSelectedVenue}
            />
          </div>
        )}
      </main>

      {/* Show Modal */}
       {selectedShow && (
        <ShowModal 
          show={selectedShow} 
          onClose={() => setSelectedShow(null)} 
 	 showBackToVenue={selectedShow.fromVenue && selectedShow.fromVenue.shows.length > 1}
          onBackToVenue={() => {
            const venueInfo = selectedShow.fromVenue;
            setSelectedShow(null);
            // Keep the venue modal open by ensuring selectedVenue stays set
            if (!selectedVenue) {
              setSelectedVenue(venueInfo);
            }
          }}
        />
      )}
      {/* Venue Modal */}
      {selectedVenue && (
        <VenueModal 
          venue={selectedVenue.name}
          shows={selectedVenue.shows}
          onClose={() => {
            setSelectedVenue(null);
            setSelectedShow(null); // Also close show modal if open
          }}
          onShowSelect={(show) => {
            setSelectedShow({ ...show, fromVenue: selectedVenue });
            // Don't close the venue modal when opening show modal
          }}
          defaultFilter={selectedVenue.defaultFilter}
        />
      )}
    </div>
  );
};

export default ShowsTracker;