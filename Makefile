all:
	echo "mrproper or deploy at this point"

mrproper:
	rm -rf ~/.meteor ~/.meteorite/ ./packages/

deploy:
	mrt release .


