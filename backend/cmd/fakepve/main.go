// Command fakepve serves a scripted Proxmox VE API, so the Proxmox import can
// be tried in a browser without a cluster. It is a development tool: it is not
// part of the image, it answers only GET, and what it serves is made up.
//
//	go run ./cmd/fakepve
//
// It prints the address, the token to enter and the fingerprint of the
// certificate it made for itself, which the app asks to be trusted the way it
// does for a real Proxmox host.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"flag"
	"log"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Butterski/homelab-builder/backend/internal/proxmox"
	"github.com/Butterski/homelab-builder/backend/internal/proxmox/pvetest"
)

// selfSigned makes a certificate the way a fresh Proxmox host has one: signed
// by nobody a browser or this app knows.
func selfSigned(names []string) (tls.Certificate, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: names[0], Organization: []string{"HLBuilder fakepve"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, name := range names {
		if ip := net.ParseIP(name); ip != nil {
			template.IPAddresses = append(template.IPAddresses, ip)
		} else {
			template.DNSNames = append(template.DNSNames, name)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	sum := sha256.Sum256(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, proxmox.FormatFingerprint(sum[:]), nil
}

func main() {
	addr := flag.String("addr", ":8006", "address to listen on")
	hosts := flag.String("hosts", "localhost,127.0.0.1,hlb-verify-fakepve", "names the certificate is made for, comma-separated")
	flag.Parse()

	certificate, fingerprint, err := selfSigned(strings.Split(*hosts, ","))
	if err != nil {
		log.Fatalf("certificate: %v", err)
	}
	server := &http.Server{
		Addr:              *addr,
		Handler:           pvetest.Demo(),
		ReadHeaderTimeout: 10 * time.Second,
		TLSConfig:         &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12},
	}
	log.Printf("fakepve: a made-up Proxmox VE API on https://<host>%s", *addr)
	log.Printf("fakepve: token id  %s", pvetest.TokenID)
	log.Printf("fakepve: secret    %s", pvetest.Secret)
	log.Printf("fakepve: SHA-256   %s", fingerprint)
	log.Fatal(server.ListenAndServeTLS("", ""))
}
