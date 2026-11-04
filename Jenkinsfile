pipeline {
  agent any
  triggers { githubPush() }
  stages {
    stage('Install frontend') {
      steps { dir('frontend') { sh 'npm ci' } }
    }
    stage('Build frontend') {
      steps { dir('frontend') { sh 'npm run build' } }
    }
    stage('Install backend dependencies') {
      steps { dir('backend') { sh 'python3 -m pip install -r requirements.txt' } }
    }
    stage('Install OCR dependencies') {
      steps {
        dir('backend') {
          sh 'python3 -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/'
          sh 'python3 -m pip install -r ocr_service/requirements.txt'
        }
      }
    }
    stage('Check OCR runtime') {
      steps {
        dir('backend') {
          sh '''
            command -v tesseract >/dev/null 2>&1 || { echo "tesseract-ocr must be installed on the Jenkins agent"; exit 1; }
            python3 -c "import paddle, paddleocr, easyocr, torch, pytesseract, fitz; print('OCR runtime dependencies are available')"
          '''
        }
      }
    }
    stage('Compile backend') {
      steps { dir('backend') { sh 'python3 -m compileall -q app ocr_service' } }
    }
    stage('Deploy Render services') {
      when { branch 'main' }
      steps {
        withCredentials([
          string(credentialsId: 'render-api-deploy-hook', variable: 'RENDER_API_DEPLOY_HOOK'),
          string(credentialsId: 'render-ocr-deploy-hook', variable: 'RENDER_OCR_DEPLOY_HOOK'),
          string(credentialsId: 'render-frontend-deploy-hook', variable: 'RENDER_FRONTEND_DEPLOY_HOOK')
        ]) {
          sh '''
            set +x
            curl --fail --silent --show-error --request POST "$RENDER_API_DEPLOY_HOOK"
            curl --fail --silent --show-error --request POST "$RENDER_OCR_DEPLOY_HOOK"
            curl --fail --silent --show-error --request POST "$RENDER_FRONTEND_DEPLOY_HOOK"
          '''
        }
      }
    }
  }
}
