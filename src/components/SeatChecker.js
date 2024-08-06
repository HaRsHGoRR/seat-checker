import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './SeatChecker.css';

const SeatChecker = () => {
  const [status, setStatus] = useState('Checking...');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = () => {
      setLoading(true);

      // Define the URL and headers
      const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
      const targetUrl = "https://gsrtc.in/OPRSOnline/advanceBooking.do?hiddenAction=SubmitToGetAjaxSeatLayout&radOnwardServiceID=41049,3,LUXURY,199,0,07:55,20:50,ANAND%20NEW,ANAND,JUNAGADH,2000ANDJNDLUX41,Y&slNo=4";
      const url = proxyUrl + targetUrl;

      const headers = {
        "Host": "gsrtc.in",
        "Cookie": "JSESSIONID=25378A32974C2B960A68DD5CFEC1BD07; _ga=GA1.2.396029660.1714044437; _ga_QL6TJ56FNH=GS1.1.1714044437.1.1.1714044638.0.0.0; __utma=95950218.117062684.1713418482.1713418482.1718514492.2; __utmz=95950218.1718514492.2.2.utmcsr=gsrtc.in|utmccn=(referral)|utmcmd=referral|utmcct=/; sc_is_visitor_unique=rx2713758.172.15.15.14.13.10.10.7.6.3",
        "Content-Length": "0",
        "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126"',
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "en-US",
        "Sec-Ch-Ua-Mobile": "?0",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36",
        "Sec-Ch-Ua-Platform": '"Linux"',
        "Origin": "https://gsrtc.in",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Referer": "https://gsrtc.in/OPRSOnline/jqreq.do?hiddenAction=SearchServiceForAvailbility",
        "Accept-Encoding": "gzip, deflate, br",
        "Priority": "u=1, i",
        "Connection": "keep-alive"
      };

      // Send the POST request using axios
      axios.post(url, {}, { headers: headers })
        .then(response => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(response.data, 'text/html');

          // Find the message element
          const errorMessage = doc.querySelector('td.errorMessageTxt');
          if (errorMessage) {
            setStatus(errorMessage.textContent.trim());
          } else {
            setStatus("SEATS AVAILABLE");
            sendSMS("SEATS AVAILABLE");
          }
          setLoading(false);
        })
        .catch(error => {
          setStatus('Error occurred: ' + error.message);
          setLoading(false);
        });
    };

    const sendSMS = (message) => {
      const account_sid = 'AC6e3581eb7c72d426408344782e271c6f';
      const auth_token = 'ece2720ad4bac0d2cf760b3060f72c78';
      const twilio_number = '+16262473366';
      const to_number = '+919979988464';

      const url = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Messages.json`;
      const data = new URLSearchParams({
        Body: message,
        From: twilio_number,
        To: to_number
      });

      const headers = {
        'Authorization': 'Basic ' + btoa(`${account_sid}:${auth_token}`),
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      fetch(url, {
        method: 'POST',
        headers: headers,
        body: data
      }).then(response => response.json())
        .then(data => console.log(data))
        .catch(error => console.error('Error sending SMS:', error));
    };

    fetchStatus();
    const intervalId = setInterval(fetchStatus, 10000);  // Fetch status every 10 seconds

    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="SeatChecker">
      <h1>Current Seat Availability Status</h1>
      {loading ? <div className="spinner"></div> : <p>{status}</p>}
    </div>
  );
};

export default SeatChecker;
