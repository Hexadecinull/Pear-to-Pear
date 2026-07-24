# Terms of Service

These terms apply to use of a public Pear-to-Pear instance (the
"Service"). They're written for whoever operates a public instance —
if you're self-hosting privately for yourself or a small group, feel
free to adapt or drop them entirely. By using a public instance, you
agree to the terms below.

## 1. What the Service is

Pear-to-Pear is a free tool for transferring files directly between two
people's browsers, with no account required. The Service consists of a
web page and a signaling/relay server that helps two browsers connect
and, when a direct connection isn't possible, streams encrypted data
between them. See [ARCHITECTURE.md](ARCHITECTURE.md) for exactly how it
works and [PRIVACY.md](PRIVACY.md) for exactly what is and isn't seen or
stored.

## 2. No accounts, no guaranteed identity

There is no sign-up and no identity verification. A "peer code" is a
temporary, random session identifier — it does not verify who someone
is. You are responsible for confirming you're bonding with the person
you intend to, by sharing codes only through channels you trust and,
for anything sensitive, verifying the six-digit security code described
in [SECURITY.md](SECURITY.md).

## 3. Acceptable use

You agree not to use the Service to transfer content that:

- Is illegal in the jurisdiction you or your recipient are in.
- Infringes someone else's intellectual property rights.
- Constitutes child sexual abuse material, in any form — this will be
  reported to the relevant authorities to the extent the operator is
  able to.
- Is malicious software intended to damage, exploit, or gain
  unauthorized access to a system.
- Violates the privacy or rights of any third party.

You also agree not to:

- Attempt to disrupt, overload, or gain unauthorized access to the
  Service or its infrastructure.
- Circumvent the file count, size, or rate limits through automation or
  modified clients in a way intended to abuse shared infrastructure.
- Use the Service to harass, threaten, or abuse another person.

## 4. On enforcement, given how little is stored

Because file content and filenames are end-to-end encrypted and never
persisted (see [PRIVACY.md](PRIVACY.md)), the operator of a public
instance generally has no practical ability to inspect, filter, or
retroactively review what was transferred. Enforcement of Section 3 is
necessarily limited to what's structurally possible: terminating active
connections that violate rate limits or size quotas, blocking abusive IP
ranges, and responding to legal process or credible reports to the
extent the operator is legally required to and technically able to.
Using the Service does not relieve you of legal responsibility for what
you transfer with it.

## 5. Availability

The Service is provided on a best-effort basis, free of charge, with no
uptime guarantee. It may be slow, interrupted, or unavailable at times,
including for maintenance, abuse mitigation, or reasons outside the
operator's control. Don't rely on it as your only method of delivering
something time-critical or irreplaceable.

## 6. No warranty

Pear-to-Pear is licensed under the GNU Affero General Public License
v3.0, which includes the following disclaimer (see [LICENSE](LICENSE)
in full):

> THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
> APPLICABLE LAW. […] THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE
> OF THE PROGRAM IS WITH YOU.

The same principle extends to use of a hosted public instance: it's
provided "as is," without warranties of any kind, express or implied,
including fitness for a particular purpose or non-infringement.

## 7. Limitation of liability

To the maximum extent permitted by applicable law, the operator of a
public instance is not liable for any indirect, incidental, special, or
consequential damages arising from your use of, or inability to use,
the Service — including but not limited to loss of data, loss of
files in transit, or loss of business, even if advised of the
possibility of such damages.

## 8. Changes to the Service or these terms

A public instance's operator may modify, suspend, or discontinue the
Service at any time, and may update these terms as the Service evolves.
Material changes will be reflected in this document's version history
in the project's repository.

## 9. Open source

The software behind the Service is free and open source, licensed under
[AGPL-3.0](LICENSE). You're welcome to inspect the code that powers this
instance, run your own instance under your own terms, or contribute
changes back — see [CONTRIBUTING.md](CONTRIBUTING.md).

## 10. Contact

Questions about these terms, or reports requiring the operator's
attention, can be raised via the issue tracker or the contact method
listed on the repository's GitHub profile, consistent with
[SECURITY.md](SECURITY.md) for anything sensitive.
