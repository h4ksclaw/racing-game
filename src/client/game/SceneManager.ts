/**
 * Three.js scene, renderer, and camera setup.
 */

import {
	AmbientLight,
	Color,
	DirectionalLight,
	Fog,
	Mesh,
	MeshStandardMaterial,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	WebGLRenderer,
} from "three";

export class SceneManager {
	readonly scene: Scene;
	private renderer: WebGLRenderer;
	private camera: PerspectiveCamera;
	private onResize: () => void;

	constructor(container: HTMLElement) {
		this.scene = new Scene();
		this.scene.background = new Color(0x87ceeb); // sky blue
		this.scene.fog = new Fog(0x87ceeb, 100, 500);

		this.camera = new PerspectiveCamera(
			60,
			container.clientWidth / container.clientHeight,
			0.1,
			1000,
		);
		this.camera.position.set(0, 10, 20);

		this.renderer = new WebGLRenderer({ antialias: true });
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = PCFSoftShadowMap;
		container.appendChild(this.renderer.domElement);

		this.onResize = () => {
			this.camera.aspect = container.clientWidth / container.clientHeight;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(container.clientWidth, container.clientHeight);
		};
		window.addEventListener("resize", this.onResize);
	}

	getCamera(): PerspectiveCamera {
		return this.camera;
	}

	add(object: Mesh): void {
		this.scene.add(object);
	}

	addDefaultLights(): void {
		const ambient = new AmbientLight(0xffffff, 0.6);
		this.scene.add(ambient);

		const sun = new DirectionalLight(0xffffff, 1.0);
		sun.position.set(50, 100, 50);
		sun.castShadow = true;
		sun.shadow.mapSize.width = 2048;
		sun.shadow.mapSize.height = 2048;
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 300;
		sun.shadow.camera.left = -100;
		sun.shadow.camera.right = 100;
		sun.shadow.camera.top = 100;
		sun.shadow.camera.bottom = -100;
		this.scene.add(sun);
	}

	addGround(): void {
		const ground = new Mesh(
			new PlaneGeometry(500, 500),
			new MeshStandardMaterial({ color: 0x3a7d3a, roughness: 0.8 }),
		);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		this.scene.add(ground);
	}

	render(): void {
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		window.removeEventListener("resize", this.onResize);
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}
}
