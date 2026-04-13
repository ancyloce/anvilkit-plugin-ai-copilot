import type { Config } from "@puckeditor/core";

const noop = (() => null) as unknown as Config["components"][string]["render"];

export const demoConfig: Config = {
	components: {
		Hero: {
			render: noop,
			fields: {
				announcementLabel: { type: "text" },
				announcementHref: { type: "text" },
				announcementOpenInNewTab: {
					type: "radio",
					options: [
						{ label: "No", value: false },
						{ label: "Yes", value: true },
					],
				},
				headline: { type: "textarea" },
				description: { type: "textarea" },
				linuxLabel: { type: "text" },
				linuxHref: { type: "text" },
				linuxOpenInNewTab: {
					type: "radio",
					options: [
						{ label: "No", value: false },
						{ label: "Yes", value: true },
					],
				},
				windowsLabel: { type: "text" },
				windowsHref: { type: "text" },
				windowsOpenInNewTab: {
					type: "radio",
					options: [
						{ label: "No", value: false },
						{ label: "Yes", value: true },
					],
				},
			},
		},
		Section: {
			render: noop,
			fields: {
				badgeLabel: { type: "text" },
				headline: { type: "text" },
				highlightedHeadline: { type: "text" },
				description: { type: "textarea" },
				content: {
					type: "slot",
					allow: ["Hero", "Statistics"],
				},
			},
		},
		BentoGrid: {
			render: noop,
			fields: {
				theme: {
					type: "select",
					options: [
						{ label: "System", value: "system" },
						{ label: "Light", value: "light" },
						{ label: "Dark", value: "dark" },
					],
				},
				platform: {
					type: "select",
					options: [
						{ label: "Adaptive", value: "adaptive" },
						{ label: "Mobile", value: "mobile" },
						{ label: "Tablet", value: "tablet" },
						{ label: "Desktop", value: "desktop" },
					],
				},
				items: {
					type: "array",
					arrayFields: {
						icon: { type: "select", options: [] },
						title: { type: "text" },
						description: { type: "textarea" },
						size: { type: "select", options: [] },
						rounded: { type: "radio", options: [] },
						background: { type: "radio", options: [] },
						ctaLabel: { type: "text" },
						ctaHref: { type: "text" },
						ctaOpenInNewTab: { type: "radio", options: [] },
					},
				},
				children: { type: "slot" },
			},
		},
		Helps: {
			render: noop,
			fields: {
				message: { type: "textarea" },
				buttonLabel: { type: "text" },
				buttonHref: { type: "text" },
				buttonOpenInNewTab: {
					type: "radio",
					options: [
						{ label: "No", value: false },
						{ label: "Yes", value: true },
					],
				},
				avatars: {
					type: "array",
					arrayFields: {
						name: { type: "text" },
						imageUrl: { type: "text" },
						initials: { type: "text" },
					},
				},
				sidebar: {
					type: "slot",
					disallow: ["Navbar"],
				},
			},
		},
		Navbar: {
			render: noop,
			fields: {
				logo: {
					type: "object",
					objectFields: {
						type: { type: "radio", options: [] },
						text: { type: "text" },
						imageUrl: { type: "text" },
						alt: { type: "text" },
						href: { type: "text" },
					},
				},
				items: {
					type: "array",
					arrayFields: {
						label: { type: "text" },
						href: { type: "text" },
					},
				},
				actions: {
					type: "array",
					arrayFields: {
						label: { type: "text" },
						href: { type: "text" },
						variant: { type: "select", options: [] },
						size: { type: "select", options: [] },
						openInNewTab: { type: "radio", options: [] },
						disabled: { type: "radio", options: [] },
					},
				},
				active: { type: "text" },
			},
		},
		LogoClouds: {
			render: noop,
			fields: {
				title: { type: "text" },
				subtitle: { type: "textarea" },
			},
		},
		Statistics: {
			render: noop,
			fields: {
				title: { type: "text" },
			},
		},
		PricingMinimal: {
			render: noop,
			fields: {
				headline: { type: "text" },
				description: { type: "textarea" },
				plans: {
					type: "array",
					arrayFields: {
						name: { type: "text" },
						description: { type: "textarea" },
						price: { type: "text" },
						billingPeriodLabel: { type: "text" },
						ctaLabel: { type: "text" },
						ctaHref: { type: "text" },
						ctaOpenInNewTab: { type: "radio", options: [] },
						featured: { type: "radio", options: [] },
						badgeLabel: { type: "text" },
						features: {
							type: "array",
							arrayFields: { label: { type: "text" } },
						},
						extraFeatures: {
							type: "array",
							arrayFields: { label: { type: "text" } },
						},
					},
				},
			},
		},
		BlogList: {
			render: noop,
			fields: {
				posts: {
					type: "array",
					arrayFields: {
						title: { type: "text" },
						description: { type: "textarea" },
						href: { type: "text" },
						openInNewTab: { type: "radio", options: [] },
						imageSrc: { type: "text" },
						imageAlt: { type: "text" },
						publishedAt: { type: "text" },
						publishedLabel: { type: "text" },
						relativeLabel: { type: "text" },
					},
				},
			},
		},
	},
};
